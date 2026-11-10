const matchingRepository = require("../repositories/matching.repository");

const PRIORITY_POINTS = Object.freeze({ LOW: 1, MEDIUM: 4, HIGH: 7, URGENT: 10 });
const PROFICIENCY_RANK = Object.freeze({ BEGINNER: 1, INTERMEDIATE: 2, ADVANCED: 3, EXPERT: 4 });
const MAX_SKILL_POINTS = 30;
const SKILL_POINTS_EACH = 10;

const normalizeLocation = (value) => typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";

const isEligibleNeed = (need, now = new Date()) => {
  if (!need || !["ACTIVE", "PARTIALLY_FULFILLED"].includes(need.status)) return false;
  if (need.deadline === null || need.deadline === undefined) return true;
  const deadlineTime = new Date(need.deadline).getTime();
  return Number.isFinite(deadlineTime) && deadlineTime > now.getTime();
};

const getQualifyingSkillMatches = (need) => {
  const uniqueSkills = new Map();
  for (const skill of need.requiredSkills || []) {
    const requiredRank = PROFICIENCY_RANK[skill.requiredLevel];
    const userRank = PROFICIENCY_RANK[skill.proficiencyLevel];
    if (!skill.skillId || !skill.name || !requiredRank || !userRank || userRank < requiredRank) continue;
    uniqueSkills.set(skill.skillId, skill);
  }
  return [...uniqueSkills.values()].sort((left, right) => left.name.localeCompare(right.name) || left.skillId.localeCompare(right.skillId));
};

const scoreNeed = (need, now = new Date()) => {
  if (!isEligibleNeed(need, now)) return null;

  let score = 0;
  const reasons = [];

  if (need.causePreferenceMatch === true) {
    score += 40;
    reasons.push(`Matches your cause preference: ${need.causeName || need.cause_name}`);
  }

  const skillMatches = getQualifyingSkillMatches(need);
  if (skillMatches.length) {
    score += Math.min(MAX_SKILL_POINTS, skillMatches.length * SKILL_POINTS_EACH);
    for (const skill of skillMatches) {
      reasons.push(`Skill match: ${skill.name} (${skill.proficiencyLevel} meets ${skill.requiredLevel})`);
    }
  }

  const userCity = normalizeLocation(need.userCity);
  const cityMatches = userCity && [need.ngoCity, need.location].some((value) => normalizeLocation(value) === userCity);
  if (cityMatches) {
    score += 20;
    reasons.push(`Located in your city: ${need.userCity.trim()}`);
  }

  const priorityPoints = PRIORITY_POINTS[need.priority] || 0;
  score += priorityPoints;
  if (priorityPoints) reasons.push(`Priority: ${need.priority} (+${priorityPoints})`);

  const {
    requiredSkills,
    userCity: _userCity,
    ngoCity,
    causePreferenceMatch,
    ...publicNeed
  } = need;
  return { ...publicNeed, score, reasons };
};

const rankRecommendations = (needs, { limit = 20, offset = 0, now = new Date() } = {}) => needs
  .map((need) => scoreNeed(need, now))
  .filter(Boolean)
  .sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftCreated = new Date(left.created_at).getTime();
    const rightCreated = new Date(right.created_at).getTime();
    const validLeftCreated = Number.isFinite(leftCreated) ? leftCreated : 0;
    const validRightCreated = Number.isFinite(rightCreated) ? rightCreated : 0;
    if (validRightCreated !== validLeftCreated) return validRightCreated - validLeftCreated;
    return String(left.need_id).localeCompare(String(right.need_id));
  })
  .slice(offset, offset + limit);

const aggregateNeedRows = (rows) => {
  const needsById = new Map();
  for (const row of rows) {
    let need = needsById.get(row.need_id);
    if (!need) {
      need = {
        need_id: row.need_id,
        cause_id: row.cause_id,
        title: row.title,
        description: row.description,
        contribution_type: row.contribution_type,
        location: row.location,
        availability: row.availability,
        quantity_required: row.quantity_required,
        quantity_fulfilled: row.quantity_fulfilled,
        priority: row.priority,
        deadline: row.deadline,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        ngo_name: row.ngo_name,
        cause_name: row.cause_name,
        userCity: row.user_city,
        ngoCity: row.ngo_city,
        causePreferenceMatch: row.cause_preference_match === true,
        requiredSkills: [],
      };
      needsById.set(row.need_id, need);
    }

    if (row.required_skill_id && row.required_skill_name) {
      need.requiredSkills.push({
        skillId: row.required_skill_id,
        name: row.required_skill_name,
        requiredLevel: row.required_level,
        proficiencyLevel: row.user_proficiency_level,
      });
    }
  }
  return [...needsById.values()];
};

const getRecommendations = async (userId, { limit = 20, offset = 0 } = {}) => {
  const rows = await matchingRepository.findEligibleNeedsForUser(userId);
  const candidates = aggregateNeedRows(rows);
  const eligibleAndRanked = rankRecommendations(candidates, {
    limit: candidates.length || 1,
    offset: 0,
  });
  return {
    items: eligibleAndRanked.slice(offset, offset + limit),
    total: eligibleAndRanked.length,
  };
};

module.exports = {
  getRecommendations,
  aggregateNeedRows,
  isEligibleNeed,
  scoreNeed,
  rankRecommendations,
};
