const path = require("node:path");
const multer = require("multer");

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 13,
    fields: 0,
  },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const supported = (extension === ".pdf" && file.mimetype === "application/pdf")
      || ([".jpg", ".jpeg"].includes(extension) && ["image/jpeg", "image/jpg"].includes(file.mimetype))
      || (extension === ".png" && file.mimetype === "image/png");
    if (!supported) {
      const error = new Error("Each document must be a PDF, JPG, JPEG, or PNG with a matching MIME type");
      error.statusCode = 400;
      error.publicCode = "UNSUPPORTED_DOCUMENT_TYPE";
      callback(error);
      return;
    }
    callback(null, true);
  },
}).fields([
  { name: "registrationCertificate", maxCount: 1 },
  { name: "pan", maxCount: 1 },
  { name: "ngoDarpan", maxCount: 1 },
  { name: "supportingDocuments", maxCount: 10 },
]);

const parseNgoVerificationUpload = (req, res, next) => {
  upload(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      error.statusCode = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      error.publicCode = error.code === "LIMIT_FILE_SIZE" ? "DOCUMENT_TOO_LARGE" : "INVALID_DOCUMENT_UPLOAD";
    }
    next(error);
  });
};

module.exports = { parseNgoVerificationUpload, MAX_FILE_SIZE_BYTES };
