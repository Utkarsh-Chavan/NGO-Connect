const crypto = require("node:crypto");
const path = require("node:path");

const ngoVerificationRepository = require("../repositories/ngoVerification.repository");
const privateDocumentStorage = require("./privateDocumentStorage.service");
const { MAX_FILE_SIZE_BYTES } = require("../middleware/ngoVerificationUpload.middleware");

const FIELD_TYPES = Object.freeze({
  registrationCertificate: "REGISTRATION_CERTIFICATE",
  pan: "PAN",
  ngoDarpan: "NGO_DARPAN",
  supportingDocuments: "SUPPORTING_DOCUMENT",
});

const createError = (message, statusCode, publicCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (publicCode) error.publicCode = publicCode;
  return error;
};

const fileDescription = (field, file) => {
  const extension = path.extname(file.originalname || "").toLowerCase();
  const extensionMime = extension === ".pdf"
    ? "application/pdf"
    : ([".jpg", ".jpeg"].includes(extension) ? "image/jpeg" : (extension === ".png" ? "image/png" : null));
  const acceptedMime = ["application/pdf", "image/jpeg", "image/jpg", "image/png"].includes(file.mimetype);
  const mimeMatchesExtension = extensionMime && (
    file.mimetype === extensionMime || (extensionMime === "image/jpeg" && file.mimetype === "image/jpg")
  );
  if (!FIELD_TYPES[field] || !acceptedMime || !mimeMatchesExtension) {
    throw createError("Each document must be a PDF, JPG, JPEG, or PNG with a matching MIME type", 400, "UNSUPPORTED_DOCUMENT_TYPE");
  }
  const buffer = file.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw createError("Uploaded documents must not be empty", 400, "EMPTY_DOCUMENT");
  }
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw createError("Each document must be no larger than 5 MiB", 413, "DOCUMENT_TOO_LARGE");
  }

  const hasPdfSignature = extension === ".pdf"
    && buffer.subarray(0, 5).equals(Buffer.from("%PDF-"));
  const hasJpegSignature = [".jpg", ".jpeg"].includes(extension)
    && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const hasPngSignature = extension === ".png" && buffer.length >= 8 && buffer.subarray(0, 8).equals(pngSignature);
  if (!hasPdfSignature && !hasJpegSignature && !hasPngSignature) {
    throw createError("Document content does not match its declared file type", 400, "DOCUMENT_SIGNATURE_MISMATCH");
  }

  const suppliedName = String(file.originalname || "document").replace(/\\/g, "/").split("/").pop();
  const originalFilename = suppliedName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255) || "document";
  return {
    documentType: FIELD_TYPES[field],
    extension: extension.slice(1),
    originalFilename,
    contentType: extensionMime,
    sizeBytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest(),
    buffer,
  };
};

const validateVerificationFiles = (files = {}) => {
  const documents = [];
  for (const [field, entries] of Object.entries(files)) {
    for (const file of entries || []) documents.push(fileDescription(field, file));
  }
  if (!documents.some(({ documentType }) => documentType === "REGISTRATION_CERTIFICATE")) {
    throw createError("A registration certificate is required", 400, "REGISTRATION_CERTIFICATE_REQUIRED");
  }
  return documents;
};

const submitVerification = async (userId, files) => {
  const documents = validateVerificationFiles(files);
  const storedDocuments = [];
  try {
    const storageProvider = privateDocumentStorage.provider();
    for (const document of documents) {
      const storageKey = `${crypto.randomUUID()}.${document.extension}`;
      await privateDocumentStorage.put(storageKey, document.buffer);
      storedDocuments.push({
        ...document,
        storageProvider,
        storageKey,
      });
    }

    return await ngoVerificationRepository.createSubmission({ userId, documents: storedDocuments });
  } catch (error) {
    const compensation = await Promise.allSettled(
      storedDocuments.map(({ storageKey }) => privateDocumentStorage.delete(storageKey))
    );
    if (compensation.some((result) => result.status === "rejected")) {
      console.error("Private document compensation failed", { documentCount: storedDocuments.length });
    }
    throw error;
  }
};

const requireMeaningfulMessage = (message, decision) => {
  if ((decision === "REJECTED" || decision === "NEEDS_INFO")
      && (typeof message !== "string" || !message.trim())) {
    throw createError("A meaningful message is required for this decision", 400, "DECISION_MESSAGE_REQUIRED");
  }
};

const getMyVerification = async (userId) => {
  const result = await ngoVerificationRepository.findNgoVerificationByUserId(userId);
  if (!result) throw createError("NGO profile not found", 404);
  return result;
};

const getAdminVerification = async (ngoId) => {
  const result = await ngoVerificationRepository.findNgoVerificationByNgoId(ngoId);
  if (!result) throw createError("NGO profile not found", 404);
  return result;
};

const decideVerification = async ({ ngoId, adminUserId, status, message }) => {
  if (!["APPROVED", "REJECTED", "NEEDS_INFO"].includes(status)) {
    throw createError("Unsupported NGO verification decision", 400);
  }
  requireMeaningfulMessage(message, status);
  const result = await ngoVerificationRepository.applyDecision({
    ngoId,
    verificationStatus: status,
    adminUserId,
    message,
  });
  if (!result) throw createError("NGO profile not found", 404);
  return result;
};

const getDocumentForAdmin = async (ngoId, documentId) => {
  const document = await ngoVerificationRepository.findVerificationDocumentForNgo(ngoId, documentId);
  if (!document) throw createError("Verification document not found", 404);
  try {
    const stored = await privateDocumentStorage.open(document.storage_key);
    return { ...document, ...stored };
  } catch (error) {
    if (error.code === "ENOENT") throw createError("Verification document not found", 404);
    throw error;
  }
};

module.exports = {
  validateVerificationFiles,
  submitVerification,
  getMyVerification,
  getAdminVerification,
  decideVerification,
  getDocumentForAdmin,
};
