const insertNotification = async (executor, {
  recipientUserId, eventType, title, message, entityType, entityId, eventKey,
}) => executor.query(
  `INSERT INTO notifications (
     recipient_user_id, event_type, title, message,
     related_entity_type, related_entity_id, event_key
   ) VALUES ($1, $2, $3, $4, $5, $6, $7)
   ON CONFLICT (event_key) DO NOTHING`,
  [recipientUserId, eventType, title, message, entityType, entityId, eventKey]
);

const createApplicationReceived = async (executor, applicationId) => executor.query(
  `INSERT INTO notifications (
     recipient_user_id, event_type, title, message,
     related_entity_type, related_entity_id, event_key
   )
   SELECT g.user_id, 'APPLICATION_RECEIVED', 'New volunteer application',
          'A volunteer applied to "' || n.title || '".',
          'APPLICATION', a.application_id,
          'application:received:' || a.application_id::text || ':' || g.user_id::text
     FROM volunteer_applications a
     JOIN needs n ON n.need_id = a.need_id
     JOIN ngos g ON g.ngo_id = n.ngo_id
    WHERE a.application_id = $1
   ON CONFLICT (event_key) DO NOTHING`,
  [applicationId]
);

const createApplicationStatus = async (executor, application) => {
  const config = {
    ACCEPTED: { title: "Volunteer application accepted", eventType: "APPLICATION_ACCEPTED", verb: "was accepted" },
    REJECTED: { title: "Volunteer application update", eventType: "APPLICATION_REJECTED", verb: "was not selected" },
    COMPLETED: { title: "Volunteer engagement completed", eventType: "APPLICATION_COMPLETED", verb: "was marked complete" },
  }[application.status];
  if (!config) return;
  await insertNotification(executor, {
    recipientUserId: application.user_id,
    eventType: config.eventType,
    title: config.title,
    message: `Your application for "${application.need_title}" ${config.verb}.`,
    entityType: "APPLICATION",
    entityId: application.application_id,
    eventKey: `application:${application.status.toLowerCase()}:${application.application_id}:${application.user_id}`,
  });
  if (["ACCEPTED", "REJECTED"].includes(application.status)) {
    const ngoResult = await executor.query(
      `SELECT g.user_id FROM needs n JOIN ngos g ON g.ngo_id = n.ngo_id WHERE n.need_id = $1`,
      [application.need_id]
    );
    const ngoUserId = ngoResult.rows[0]?.user_id;
    if (ngoUserId) {
      await insertNotification(executor, {
        recipientUserId: ngoUserId,
        eventType: config.eventType,
        title: "Application status saved",
        message: `The application for "${application.need_title}" was ${application.status.toLowerCase()}.`,
        entityType: "APPLICATION",
        entityId: application.application_id,
        eventKey: `application:${application.status.toLowerCase()}:${application.application_id}:${ngoUserId}`,
      });
    }
  }
};

const createContributionReceived = async (executor, contributionId) => executor.query(
  `INSERT INTO notifications (
     recipient_user_id, event_type, title, message,
     related_entity_type, related_entity_id, event_key
   )
   SELECT g.user_id, 'CONTRIBUTION_RECEIVED', 'New contribution',
          'A community member offered support for "' || n.title || '".',
          'CONTRIBUTION', c.contribution_id,
          'contribution:received:' || c.contribution_id::text || ':' || g.user_id::text
     FROM contributions c
     JOIN needs n ON n.need_id = c.need_id
     JOIN ngos g ON g.ngo_id = n.ngo_id
    WHERE c.contribution_id = $1
   ON CONFLICT (event_key) DO NOTHING`,
  [contributionId]
);

const createContributionStatus = async (executor, contribution) => {
  const config = {
    ACCEPTED: { title: "Contribution accepted", eventType: "CONTRIBUTION_ACCEPTED", verb: "was accepted" },
    REJECTED: { title: "Contribution update", eventType: "CONTRIBUTION_REJECTED", verb: "was not accepted" },
    IN_PROGRESS: { title: "Contribution in progress", eventType: "CONTRIBUTION_IN_PROGRESS", verb: "is now in progress" },
    COMPLETED: { title: "Contribution completed", eventType: "CONTRIBUTION_COMPLETED", verb: "was marked complete" },
  }[contribution.status];
  if (!config) return;
  await insertNotification(executor, {
    recipientUserId: contribution.user_id,
    eventType: config.eventType,
    title: config.title,
    message: `Your support for "${contribution.need_title}" ${config.verb}.`,
    entityType: "CONTRIBUTION",
    entityId: contribution.contribution_id,
    eventKey: `contribution:${contribution.status.toLowerCase()}:${contribution.contribution_id}:${contribution.user_id}`,
  });
  const ngoResult = await executor.query(
    `SELECT g.user_id FROM needs n JOIN ngos g ON g.ngo_id = n.ngo_id WHERE n.need_id = $1`,
    [contribution.need_id]
  );
  const ngoUserId = ngoResult.rows[0]?.user_id;
  if (ngoUserId) {
    await insertNotification(executor, {
      recipientUserId: ngoUserId,
      eventType: config.eventType,
      title: "Contribution status saved",
      message: `The contribution for "${contribution.need_title}" was updated to ${contribution.status.toLowerCase().replaceAll('_', ' ')}.`,
      entityType: "CONTRIBUTION",
      entityId: contribution.contribution_id,
      eventKey: `contribution:${contribution.status.toLowerCase()}:${contribution.contribution_id}:${ngoUserId}`,
    });
  }
};

const createVerificationSubmitted = async (executor, { ngoUserId, submissionId }) => {
  await insertNotification(executor, {
    recipientUserId: ngoUserId,
    eventType: "NGO_VERIFICATION_SUBMITTED",
    title: "Verification submission received",
    message: "Your organization verification submission is queued for review.",
    entityType: "NGO_VERIFICATION",
    entityId: submissionId,
    eventKey: `ngo-verification:submitted:${submissionId}:${ngoUserId}`,
  });
  const admins = await executor.query(
    "SELECT user_id FROM users WHERE role = 'ADMIN' AND is_suspended = FALSE"
  );
  for (const admin of admins.rows) {
    await insertNotification(executor, {
      recipientUserId: admin.user_id,
      eventType: "NGO_VERIFICATION_SUBMITTED",
      title: "NGO verification submitted",
      message: "An organization submitted documents for verification review.",
      entityType: "NGO_VERIFICATION",
      entityId: submissionId,
      eventKey: `ngo-verification:submitted:${submissionId}:${admin.user_id}`,
    });
  }
};

const createVerificationDecision = async (executor, { ngoUserId, submissionId, status }) => {
  const config = {
    NEEDS_INFO: { eventType: "NGO_VERIFICATION_NEEDS_INFO", title: "More information requested", message: "An administrator requested additional information for your organization verification." },
    APPROVED: { eventType: "NGO_VERIFICATION_APPROVED", title: "Organization verification approved", message: "Your organization verification was approved." },
    REJECTED: { eventType: "NGO_VERIFICATION_REJECTED", title: "Organization verification update", message: "Your organization verification was not approved. Review the verification page for details." },
  }[status];
  if (!config) return;
  return insertNotification(executor, {
    recipientUserId: ngoUserId,
    ...config,
    entityType: "NGO_VERIFICATION",
    entityId: submissionId,
    eventKey: `ngo-verification:${status.toLowerCase()}:${submissionId}:${ngoUserId}`,
  });
};

const createNeedClosedNotices = async (executor, { need_id: needId, title, engagements }) => {
  for (const engagement of engagements) {
    const pending = ["APPLIED", "PENDING"].includes(engagement.status);
    const kind = engagement.entityType === "APPLICATION" ? "application" : "contribution";
    await insertNotification(executor, {
      recipientUserId: engagement.user_id,
      eventType: "NEED_CLOSED",
      title: "A need you responded to was closed",
      message: pending
        ? `"${title}" was closed by the organization. Your pending ${kind} was canceled; no record was deleted.`
        : `"${title}" was closed by the organization. Your accepted engagement remains active and can still be completed.`,
      entityType: engagement.entityType,
      entityId: engagement.entityId,
      eventKey: `need-lifecycle:closed:${needId}:${engagement.entityType.toLowerCase()}:${engagement.entityId}:${engagement.user_id}`,
    });
  }
};

const createNeedLifecycleNotices = async (executor, { need_id: needId, ngo_id: ngoId, title, eventType }) => {
  const [ngoResult, engagementResult] = await Promise.all([
    executor.query("SELECT user_id FROM ngos WHERE ngo_id = $1", [ngoId]),
    executor.query(
      `SELECT 'APPLICATION'::text AS entity_type, application_id AS entity_id, user_id, status
         FROM volunteer_applications WHERE need_id = $1 AND status IN ('APPLIED', 'ACCEPTED')
       UNION ALL
       SELECT 'CONTRIBUTION'::text, contribution_id, user_id, status
         FROM contributions WHERE need_id = $1 AND status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS')`,
      [needId]
    ),
  ]);
  const eventKey = `need-lifecycle:${eventType === "NEED_EXPIRED" ? "expired" : "closed"}`;
  if (eventType === "NEED_EXPIRED" && ngoResult.rows[0]) {
    await insertNotification(executor, {
      recipientUserId: ngoResult.rows[0].user_id,
      eventType,
      title: "A need has expired",
      message: `"${title}" reached its deadline and no longer accepts new responses.`,
      entityType: "NEED",
      entityId: needId,
      eventKey: `${eventKey}:${needId}:ngo:${ngoResult.rows[0].user_id}`,
    });
  }
  for (const engagement of engagementResult.rows) {
    const pending = ["APPLIED", "PENDING"].includes(engagement.status);
    const kind = engagement.entity_type === "APPLICATION" ? "application" : "contribution";
    await insertNotification(executor, {
      recipientUserId: engagement.user_id,
      eventType,
      title: eventType === "NEED_EXPIRED" ? "A need has expired" : "A need was closed",
      message: eventType === "NEED_EXPIRED"
        ? `"${title}" reached its deadline. Your ${pending ? `pending ${kind}` : "existing engagement"} remains in the organization's history.`
        : `"${title}" was closed by the organization. Your pending ${kind} was canceled.`,
      entityType: engagement.entity_type,
      entityId: engagement.entity_id,
      eventKey: `${eventKey}:${needId}:${engagement.entity_type.toLowerCase()}:${engagement.entity_id}:${engagement.user_id}`,
    });
  }
};

module.exports = {
  insertNotification,
  createApplicationReceived,
  createApplicationStatus,
  createContributionReceived,
  createContributionStatus,
  createVerificationSubmitted,
  createVerificationDecision,
  createNeedClosedNotices,
  createNeedLifecycleNotices,
};
