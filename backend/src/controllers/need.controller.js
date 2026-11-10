const needService = require("../services/need.service");

const create = async (req, res, next) => {
  try {
    const need = await needService.createNeed(req.user.userId, req.body);
    res.status(201).json({ success: true, message: "Need created successfully", data: need });
  } catch (error) {
    next(error);
  }
};

const list = async (req, res, next) => {
  try {
    const query = req.query;
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    const filters = {
      search: typeof query.search === "string" ? query.search.trim() || null : null,
      causeId: typeof query.causeId === "string" ? query.causeId.trim().toLowerCase() : null,
      contributionType: typeof query.contributionType === "string" ? query.contributionType.trim().toUpperCase() : null,
      location: typeof query.location === "string" ? query.location.trim() || null : null,
    };
    const result = await needService.listNeeds({ ...filters, limit, offset });
    res.status(200).json({
      success: true,
      message: "Needs retrieved successfully",
      data: {
        items: result.items,
        pagination: {
          limit,
          offset,
          total: result.total,
          hasPrevious: offset > 0,
          hasNext: offset + result.items.length < result.total,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

const getById = async (req, res, next) => {
  try {
    const need = await needService.getNeed(req.params.id);
    res.status(200).json({ success: true, message: "Need retrieved successfully", data: need });
  } catch (error) {
    next(error);
  }
};

const update = async (req, res, next) => {
  try {
    const need = await needService.updateNeed(req.user.userId, req.params.id, req.body);
    res.status(200).json({ success: true, message: "Need updated successfully", data: need });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  create,
  list,
  getById,
  update,
};
