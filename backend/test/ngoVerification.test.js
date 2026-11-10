const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");

const ngoVerificationService = require("../src/services/ngoVerification.service");
const ngoVerificationRepository = require("../src/repositories/ngoVerification.repository");
const ngoVerificationController = require("../src/controllers/ngoVerification.controller");
const privateDocumentStorage = require("../src/services/privateDocumentStorage.service");
const createLocalPrivateStorage = require("../src/services/storage/localPrivateStorage.adapter");
const { MAX_FILE_SIZE_BYTES } = require("../src/middleware/ngoVerificationUpload.middleware");
const authorize = require("../src/middleware/role.middleware");
const authenticate = require("../src/middleware/auth.middleware");
const userRepository = require("../src/repositories/user.repository");

const pdfFile = (overrides = {}) => ({
  originalname: "registration.pdf",
  mimetype: "application/pdf",
  buffer: Buffer.from("%PDF-1.7\nunit fixture"),
  ...overrides,
});

const makeResponse = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

afterEach(() => {
  privateDocumentStorage.setStorageAdapter(null);
});

test("verification submission requires a registration certificate and accepts optional document types", () => {
  assert.throws(
    () => ngoVerificationService.validateVerificationFiles({ pan: [{
      originalname: "pan.jpg", mimetype: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff]),
    }] }),
    (error) => error.statusCode === 400 && error.publicCode === "REGISTRATION_CERTIFICATE_REQUIRED"
  );

  const documents = ngoVerificationService.validateVerificationFiles({
    registrationCertificate: [pdfFile()],
    pan: [{ originalname: "pan.jpg", mimetype: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff]) }],
    ngoDarpan: [{ originalname: "darpan.png", mimetype: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }],
    supportingDocuments: [pdfFile({ originalname: "support.pdf" })],
  });
  assert.deepEqual(documents.map(({ documentType }) => documentType), [
    "REGISTRATION_CERTIFICATE", "PAN", "NGO_DARPAN", "SUPPORTING_DOCUMENT",
  ]);
});

test("verification upload rejects empty, oversized, mismatched MIME and forged signatures", () => {
  for (const file of [
    pdfFile({ buffer: Buffer.alloc(0) }),
    pdfFile({ buffer: Buffer.alloc(MAX_FILE_SIZE_BYTES + 1) }),
    pdfFile({ mimetype: "image/png" }),
    pdfFile({ buffer: Buffer.from("not a PDF") }),
  ]) {
    assert.throws(() => ngoVerificationService.validateVerificationFiles({ registrationCertificate: [file] }));
  }
  assert.throws(
    () => ngoVerificationService.validateVerificationFiles({ registrationCertificate: [pdfFile({ originalname: "../../unsafe.exe" })] }),
    (error) => error.statusCode === 400
  );
});

test("verification metadata hashes file bytes and submission uses opaque random object keys", async () => {
  const originalCreate = ngoVerificationRepository.createSubmission;
  const uploaded = [];
  privateDocumentStorage.setStorageAdapter({
    provider: "UNIT_PRIVATE",
    async put(key, buffer) { uploaded.push({ key, buffer: Buffer.from(buffer) }); },
    async open() { throw new Error("not used"); },
    async delete() {},
  });
  ngoVerificationRepository.createSubmission = async ({ documents }) => ({ documents });
  const bytes = Buffer.from("%PDF-1.7\nsecret test document");
  try {
    const result = await ngoVerificationService.submitVerification("user-id", {
      registrationCertificate: [pdfFile({ originalname: "../../my certificate.pdf", buffer: bytes })],
    });
    assert.deepEqual(result.documents[0].sha256, crypto.createHash("sha256").update(bytes).digest());
    assert.equal(result.documents[0].originalFilename, "my certificate.pdf");
    assert.match(uploaded[0].key, /^[0-9a-f-]{36}\.pdf$/);
    assert.equal(uploaded[0].key.includes("my certificate"), false);
    assert.equal(result.documents[0].storageProvider, "UNIT_PRIVATE");
  } finally {
    ngoVerificationRepository.createSubmission = originalCreate;
  }
});

test("database submission failure compensates only newly uploaded objects", async () => {
  const originalCreate = ngoVerificationRepository.createSubmission;
  const stored = new Set();
  const deleted = [];
  privateDocumentStorage.setStorageAdapter({
    provider: "UNIT_PRIVATE",
    async put(key) { stored.add(key); },
    async open() { throw new Error("not used"); },
    async delete(key) { deleted.push(key); stored.delete(key); },
  });
  ngoVerificationRepository.createSubmission = async () => { throw new Error("transaction failed"); };
  try {
    await assert.rejects(
      ngoVerificationService.submitVerification("user-id", { registrationCertificate: [pdfFile()] }),
      /transaction failed/
    );
    assert.equal(stored.size, 0);
    assert.equal(deleted.length, 1);
  } finally {
    ngoVerificationRepository.createSubmission = originalCreate;
  }
});

test("local private storage rejects path traversal and reads/deletes only opaque objects", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ngo-private-storage-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storage = createLocalPrivateStorage(root);
  const key = `${crypto.randomUUID()}.pdf`;
  const content = Buffer.from("%PDF-1.4\nprivate");
  await storage.put(key, content);
  const result = await storage.open(key);
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), content);
  assert.equal(result.size, content.length);
  await assert.rejects(storage.open("../secret.pdf"), (error) => error.statusCode === 400);
  await storage.delete(key);
  await assert.rejects(storage.open(key), (error) => error.code === "ENOENT");
});

test("verification decisions require messages for rejection and information requests", async () => {
  const originalDecision = ngoVerificationRepository.applyDecision;
  let received;
  ngoVerificationRepository.applyDecision = async (input) => { received = input; return { verification_status: input.verificationStatus }; };
  try {
    await assert.rejects(
      ngoVerificationService.decideVerification({ ngoId: "ngo", adminUserId: "admin", status: "REJECTED" }),
      (error) => error.statusCode === 400 && error.publicCode === "DECISION_MESSAGE_REQUIRED"
    );
    await assert.rejects(
      ngoVerificationService.decideVerification({ ngoId: "ngo", adminUserId: "admin", status: "NEEDS_INFO", message: "  " }),
      (error) => error.statusCode === 400
    );
    assert.deepEqual(await ngoVerificationService.decideVerification({
      ngoId: "ngo", adminUserId: "admin", status: "NEEDS_INFO", message: "Please attach a certificate.",
    }), { verification_status: "NEEDS_INFO" });
    assert.equal(received.message, "Please attach a certificate.");
    await assert.rejects(
      ngoVerificationService.decideVerification({ ngoId: "ngo", adminUserId: "admin", status: "PENDING" }),
      (error) => error.statusCode === 400
    );
  } finally {
    ngoVerificationRepository.applyDecision = originalDecision;
  }
});

test("approval controller accepts an omitted optional JSON body", async () => {
  const originalDecision = ngoVerificationService.decideVerification;
  let received;
  ngoVerificationService.decideVerification = async (input) => {
    received = input;
    return { verification_status: input.status };
  };
  const response = makeResponse();
  try {
    await ngoVerificationController.approve({ params: { ngoId: "ngo-id" }, user: { userId: "admin-id" } }, response, (error) => {
      if (error) throw error;
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(received, {
      ngoId: "ngo-id", adminUserId: "admin-id", status: "APPROVED", message: undefined,
    });
  } finally {
    ngoVerificationService.decideVerification = originalDecision;
  }
});

test("admin document access checks NGO/document relationship before opening storage", async () => {
  const originalFind = ngoVerificationRepository.findVerificationDocumentForNgo;
  const originalOpen = privateDocumentStorage.open;
  let opened = false;
  ngoVerificationRepository.findVerificationDocumentForNgo = async () => null;
  privateDocumentStorage.open = async () => { opened = true; };
  try {
    await assert.rejects(
      ngoVerificationService.getDocumentForAdmin("other-ngo", "document-id"),
      (error) => error.statusCode === 404
    );
    assert.equal(opened, false);
  } finally {
    ngoVerificationRepository.findVerificationDocumentForNgo = originalFind;
    privateDocumentStorage.open = originalOpen;
  }
});

test("role middleware rejects individual uploads and non-admin document requests", async () => {
  process.env.JWT_SECRET = "ngo-verification-middleware-test-secret";
  const token = jwt.sign({ userId: "user-id", role: "INDIVIDUAL" }, process.env.JWT_SECRET);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const authResponse = makeResponse();
  let authenticated = false;
  const originalStatus = userRepository.findAuthStatusById;
  userRepository.findAuthStatusById = async (userId) => ({ user_id: userId, is_suspended: false });
  await authenticate(req, authResponse, () => { authenticated = true; });
  userRepository.findAuthStatusById = originalStatus;
  assert.equal(authenticated, true);

  let ngoAllowed = false;
  authorize("NGO")(req, makeResponse(), () => { ngoAllowed = true; });
  assert.equal(ngoAllowed, false);
  const adminResponse = makeResponse();
  let adminAllowed = false;
  authorize("ADMIN")(req, adminResponse, () => { adminAllowed = true; });
  assert.equal(adminAllowed, false);
  assert.equal(adminResponse.statusCode, 403);
});
