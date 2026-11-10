const repository = require("../repositories/notification.repository");

const navigationTargetFor = (eventType, role, entityType = null, entityId = null) => {
  if (["NEED_CLOSED", "NEED_EXPIRED"].includes(eventType)) {
    if (role === "NGO" && entityType === "NEED") return `/ngo/needs/${entityId}`;
    if (role === "INDIVIDUAL" && entityType === "APPLICATION") return "/individual/responses";
    if (role === "INDIVIDUAL" && entityType === "CONTRIBUTION") return "/individual/contributions";
    return null;
  }
  if (eventType === "APPLICATION_RECEIVED" || eventType === "CONTRIBUTION_RECEIVED") {
    return role === "NGO" ? "/ngo/responses" : null;
  }
  if (["APPLICATION_ACCEPTED", "APPLICATION_REJECTED", "APPLICATION_COMPLETED"].includes(eventType)) {
    if (role === "NGO") return "/ngo/responses";
    return role === "INDIVIDUAL" ? "/individual/responses" : null;
  }
  if (["CONTRIBUTION_ACCEPTED", "CONTRIBUTION_REJECTED", "CONTRIBUTION_IN_PROGRESS", "CONTRIBUTION_COMPLETED"].includes(eventType)) {
    if (role === "NGO") return "/ngo/responses";
    return role === "INDIVIDUAL" ? "/individual/contributions" : null;
  }
  if (eventType === "NGO_VERIFICATION_SUBMITTED" && role === "ADMIN") return "/admin/ngos/pending";
  if (eventType.startsWith("NGO_VERIFICATION_") && role === "NGO") return "/ngo/verification";
  return null;
};

const fail = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const listNotifications = async (userId, role, filters) => {
  const page = await repository.listForUser(userId, filters);
  return {
    items: page.items.map((item) => ({
      ...item,
      navigation_target: navigationTargetFor(item.event_type, role, item.related_entity_type, item.related_entity_id),
    })),
    total: page.total,
  };
};

const markRead = async (notificationId, userId, role) => {
  const notification = await repository.markReadForUser(notificationId, userId);
  if (!notification) throw fail("Notification not found", 404);
  return { ...notification, navigation_target: navigationTargetFor(notification.event_type, role, notification.related_entity_type, notification.related_entity_id) };
};

module.exports = {
  navigationTargetFor,
  listNotifications,
  getUnreadCount: (userId) => repository.countUnreadForUser(userId),
  markRead,
  markAllRead: (userId) => repository.markAllReadForUser(userId),
};
