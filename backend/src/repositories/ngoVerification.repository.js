const pool = require("../config/database");
const transactionRepository = require("./transaction.repository");
const notificationEvents = require("./notificationEvents.repository");

const createConflict = (message, publicCode = "INVALID_VERIFICATION_TRANSITION") => {
  const error = new Error(message);
  error.statusCode = 409;
  error.publicCode = publicCode;
  return error;
};

const appendHistory = async (executor, {
  ngoId, ngoName, status, submissionId, actorUserId, actorName, action, message,
}) => executor.query(
  `INSERT INTO ngo_verification_history (
     ngo_id_snapshot, ngo_name_snapshot, verification_status_snapshot,
     submission_id_snapshot, actor_user_id_snapshot, actor_name_snapshot,
     action, message
   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
  [ngoId, ngoName, status, submissionId, actorUserId, actorName, action, message]
);

const getVerificationDetailsByNgoId = async (executor, ngoId) => {
  const ngoResult = await executor.query(
    `SELECT ngo_id, name, description, email, phone, address, city, website_url,
            verification_status, created_at, updated_at
       FROM ngos
      WHERE ngo_id = $1`,
    [ngoId]
  );
  const ngo = ngoResult.rows[0];
  if (!ngo) return null;

  const submissionResult = await executor.query(
    `SELECT submission_id, submission_number, status, submitted_at, created_at, updated_at
       FROM ngo_verification_submissions
      WHERE ngo_id_snapshot = $1 AND is_current = TRUE`,
    [ngoId]
  );
  const submission = submissionResult.rows[0] || null;
  let documents = [];
  if (submission) {
    const documentResult = await executor.query(
      `SELECT document_id, document_type, original_filename, content_type,
              size_bytes, created_at
         FROM ngo_verification_documents
        WHERE submission_id_snapshot = $1
        ORDER BY created_at ASC, document_id ASC`,
      [submission.submission_id]
    );
    documents = documentResult.rows;
  }

  const historyResult = await executor.query(
    `SELECT history_id, verification_status_snapshot, submission_id_snapshot,
            actor_name_snapshot, action, message, created_at
       FROM ngo_verification_history
      WHERE ngo_id_snapshot = $1
      ORDER BY created_at ASC, history_id ASC`,
    [ngoId]
  );

  return {
    ngo,
    currentSubmission: submission ? { ...submission, documents } : null,
    history: historyResult.rows,
  };
};

const findNgoVerificationByUserId = async (userId) => {
  const ngoResult = await pool.query("SELECT ngo_id FROM ngos WHERE user_id = $1", [userId]);
  const ngoId = ngoResult.rows[0]?.ngo_id;
  if (!ngoId) return null;
  return getVerificationDetailsByNgoId(pool, ngoId);
};

const findNgoVerificationByNgoId = async (ngoId) => getVerificationDetailsByNgoId(pool, ngoId);

const createSubmission = async ({ userId, documents }) => transactionRepository.withTransaction(async (client) => {
  const ngoResult = await client.query(
    `SELECT ngo_id, name, verification_status
       FROM ngos
      WHERE user_id = $1
      FOR UPDATE`,
    [userId]
  );
  const ngo = ngoResult.rows[0];
  if (!ngo) {
    const error = new Error("NGO profile not found");
    error.statusCode = 404;
    throw error;
  }

  const currentResult = await client.query(
    `SELECT submission_id, status
       FROM ngo_verification_submissions
      WHERE ngo_id_snapshot = $1 AND is_current = TRUE
      FOR UPDATE`,
    [ngo.ngo_id]
  );
  const current = currentResult.rows[0] || null;
  const initialSubmission = ngo.verification_status === "NOT_SUBMITTED" && !current;
  const resubmission = ["NEEDS_INFO", "REJECTED"].includes(ngo.verification_status)
    && current?.status === ngo.verification_status;
  if (!initialSubmission && !resubmission) {
    throw createConflict("NGO verification cannot be submitted in its current status");
  }

  const numberResult = await client.query(
    `SELECT COALESCE(MAX(submission_number), 0)::integer + 1 AS next_number
       FROM ngo_verification_submissions
      WHERE ngo_id_snapshot = $1`,
    [ngo.ngo_id]
  );
  const submissionNumber = numberResult.rows[0].next_number;

  if (current) {
    const superseded = await client.query(
      `UPDATE ngo_verification_submissions
          SET status = 'SUPERSEDED', is_current = FALSE, updated_at = NOW()
        WHERE submission_id = $1 AND ngo_id_snapshot = $2 AND is_current = TRUE
        RETURNING submission_id`,
      [current.submission_id, ngo.ngo_id]
    );
    if (!superseded.rows[0]) throw createConflict("Current verification submission changed", "CURRENT_SUBMISSION_CHANGED");
  }

  const submissionResult = await client.query(
    `INSERT INTO ngo_verification_submissions (
       ngo_id, ngo_id_snapshot, submission_number, status, is_current,
       legacy_import, submitted_by_user_id, submitted_at
     ) VALUES ($1, $1, $2, 'PENDING', TRUE, FALSE, $3, NOW())
     RETURNING submission_id`,
    [ngo.ngo_id, submissionNumber, userId]
  );
  const submissionId = submissionResult.rows[0].submission_id;

  for (const document of documents) {
    await client.query(
      `INSERT INTO ngo_verification_documents (
         submission_id, submission_id_snapshot, document_type, storage_provider,
         storage_key, original_filename, content_type, size_bytes, sha256,
         uploaded_by_user_id
       ) VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        submissionId,
        document.documentType,
        document.storageProvider,
        document.storageKey,
        document.originalFilename,
        document.contentType,
        document.sizeBytes,
        document.sha256,
        userId,
      ]
    );
  }

  const updatedNgoResult = await client.query(
    `UPDATE ngos
        SET verification_status = 'PENDING', updated_at = NOW()
      WHERE ngo_id = $1
      RETURNING ngo_id`,
    [ngo.ngo_id]
  );
  if (!updatedNgoResult.rows[0]) throw createConflict("NGO profile changed during submission");

  const actorResult = await client.query("SELECT name FROM users WHERE user_id = $1", [userId]);
  const actorName = actorResult.rows[0]?.name || null;
  await appendHistory(client, {
    ngoId: ngo.ngo_id,
    ngoName: ngo.name,
    status: "PENDING",
    submissionId,
    actorUserId: userId,
    actorName,
    action: initialSubmission ? "SUBMITTED" : "RESUBMITTED",
    message: null,
  });

  await notificationEvents.createVerificationSubmitted(client, {
    ngoUserId: userId,
    submissionId,
  });

  return getVerificationDetailsByNgoId(client, ngo.ngo_id);
});

const applyDecision = async ({ ngoId, verificationStatus, adminUserId, message }) =>
  transactionRepository.withTransaction(async (client) => {
    const ngoResult = await client.query(
      `SELECT ngo_id, user_id, name, verification_status
         FROM ngos WHERE ngo_id = $1 FOR UPDATE`,
      [ngoId]
    );
    const ngo = ngoResult.rows[0];
    if (!ngo) return null;

    const submissionResult = await client.query(
      `SELECT submission_id, status
         FROM ngo_verification_submissions
        WHERE ngo_id_snapshot = $1 AND is_current = TRUE
        FOR UPDATE`,
      [ngoId]
    );
    const submission = submissionResult.rows[0];
    if (!submission) throw createConflict("NGO has no current verification submission to review", "CURRENT_SUBMISSION_REQUIRED");
    if (ngo.verification_status !== "PENDING" || submission.status !== "PENDING") {
      throw createConflict("Only a pending verification submission can be reviewed");
    }

    if (verificationStatus === "APPROVED") {
      const certificateResult = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM ngo_verification_documents
            WHERE submission_id_snapshot = $1
              AND document_type = 'REGISTRATION_CERTIFICATE'
         ) AS has_registration_certificate`,
        [submission.submission_id]
      );
      if (!certificateResult.rows[0].has_registration_certificate) {
        throw createConflict("A registration certificate is required before approval", "REGISTRATION_CERTIFICATE_REQUIRED");
      }
    }

    const adminResult = await client.query("SELECT name FROM users WHERE user_id = $1", [adminUserId]);
    const admin = adminResult.rows[0];
    if (!admin) {
      const error = new Error("Admin account no longer exists");
      error.statusCode = 403;
      throw error;
    }

    const action = verificationStatus === "NEEDS_INFO" ? "INFO_REQUESTED" : verificationStatus;
    const historyMessage = typeof message === "string" && message.trim()
      ? message.trim()
      : "Verification approved by administrator.";
    const updatedNgoResult = await client.query(
      `UPDATE ngos SET verification_status = $2, updated_at = NOW()
        WHERE ngo_id = $1
      RETURNING ngo_id, name, description, email, phone, address, city, website_url,
                  verification_status, created_at, updated_at`,
      [ngoId, verificationStatus]
    );
    const updatedSubmissionResult = await client.query(
      `UPDATE ngo_verification_submissions
          SET status = $2, updated_at = NOW()
        WHERE submission_id = $1 AND ngo_id_snapshot = $3 AND is_current = TRUE
        RETURNING submission_id`,
      [submission.submission_id, verificationStatus, ngoId]
    );
    if (!updatedSubmissionResult.rows[0]) throw createConflict("Current verification submission changed", "CURRENT_SUBMISSION_CHANGED");

    await appendHistory(client, {
      ngoId,
      ngoName: ngo.name,
      status: verificationStatus,
      submissionId: submission.submission_id,
      actorUserId: adminUserId,
      actorName: admin.name,
      action,
      message: historyMessage,
    });
    await notificationEvents.createVerificationDecision(client, {
      ngoUserId: ngo.user_id,
      submissionId: submission.submission_id,
      status: verificationStatus,
    });
    return updatedNgoResult.rows[0];
  });

const findVerificationDocumentForNgo = async (ngoId, documentId) => {
  const result = await pool.query(
    `SELECT d.document_id, d.storage_provider, d.storage_key,
            d.original_filename, d.content_type, d.size_bytes
       FROM ngo_verification_documents d
       JOIN ngo_verification_submissions s
         ON s.submission_id = d.submission_id_snapshot
       JOIN ngos g ON g.ngo_id = s.ngo_id_snapshot
      WHERE g.ngo_id = $1 AND d.document_id = $2`,
    [ngoId, documentId]
  );
  return result.rows[0] || null;
};

module.exports = {
  findNgoVerificationByUserId,
  findNgoVerificationByNgoId,
  createSubmission,
  applyDecision,
  findVerificationDocumentForNgo,
};
