const ngoVerificationService = require("../services/ngoVerification.service");
const ALLOWED_DOCUMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

const submitMe = async (req, res, next) => {
  try {
    const result = await ngoVerificationService.submitVerification(req.user.userId, req.files);
    res.status(201).json({
      success: true,
      message: "NGO verification submission received",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    const result = await ngoVerificationService.getMyVerification(req.user.userId);
    res.status(200).json({ success: true, message: "NGO verification retrieved", data: result });
  } catch (error) {
    next(error);
  }
};

const getAdminVerification = async (req, res, next) => {
  try {
    const result = await ngoVerificationService.getAdminVerification(req.params.ngoId);
    res.status(200).json({ success: true, message: "NGO verification retrieved", data: result });
  } catch (error) {
    next(error);
  }
};

const getAdminDocument = async (req, res, next) => {
  try {
    const document = await ngoVerificationService.getDocumentForAdmin(req.params.ngoId, req.params.documentId);
    const fallbackName = document.original_filename.replace(/[^A-Za-z0-9._-]/g, "_").replace(/["\\]/g, "_");
    const contentType = ALLOWED_DOCUMENT_TYPES.has(document.content_type)
      ? document.content_type
      : "application/octet-stream";
    res.status(200);
    res.set({
      "Content-Type": contentType,
      "Content-Length": String(document.size),
      "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(document.original_filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    document.stream.on("error", (error) => {
      if (res.headersSent) res.destroy(error);
      else next(error);
    });
    document.stream.pipe(res);
  } catch (error) {
    next(error);
  }
};

const makeDecisionController = (status) => async (req, res, next) => {
  try {
    const result = await ngoVerificationService.decideVerification({
      ngoId: req.params.ngoId,
      adminUserId: req.user.userId,
      status,
      message: req.body?.message,
    });
    res.status(200).json({ success: true, message: "NGO verification decision saved", data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  submitMe,
  getMe,
  getAdminVerification,
  getAdminDocument,
  approve: makeDecisionController("APPROVED"),
  reject: makeDecisionController("REJECTED"),
  requestInfo: makeDecisionController("NEEDS_INFO"),
};
