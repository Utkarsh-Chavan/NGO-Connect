const service = require("../services/notification.service");

const list = async (req, res, next) => {
  try {
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    const unreadOnly = req.query.unreadOnly === undefined
      ? false
      : String(req.query.unreadOnly).toLowerCase() === "true";
    const result = await service.listNotifications(req.user.userId, req.user.role, { limit, offset, unreadOnly });
    res.status(200).json({
      success: true,
      message: "Notifications retrieved",
      data: {
        items: result.items,
        pagination: {
          limit, offset, total: result.total,
          hasPrevious: offset > 0,
          hasNext: offset + result.items.length < result.total,
        },
        unreadOnly,
      },
    });
  } catch (error) { next(error); }
};

const unreadCount = async (req, res, next) => {
  try {
    const unreadCount = await service.getUnreadCount(req.user.userId);
    res.status(200).json({ success: true, message: "Unread count retrieved", data: { unreadCount } });
  } catch (error) { next(error); }
};

const markRead = async (req, res, next) => {
  try {
    const notification = await service.markRead(req.params.notificationId, req.user.userId, req.user.role);
    res.status(200).json({ success: true, message: "Notification marked as read", data: notification });
  } catch (error) { next(error); }
};

const markAllRead = async (req, res, next) => {
  try {
    const updatedCount = await service.markAllRead(req.user.userId);
    res.status(200).json({ success: true, message: "Notifications marked as read", data: { updatedCount } });
  } catch (error) { next(error); }
};

module.exports = { list, unreadCount, markRead, markAllRead };
