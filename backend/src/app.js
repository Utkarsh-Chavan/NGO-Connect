const express = require("express");
const cors = require("cors");

const errorHandler = require("./middleware/error.middleware");
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const ngoRoutes = require("./routes/ngo.routes");
const causeRoutes = require("./routes/cause.routes");
const skillRoutes = require("./routes/skill.routes");
const needRoutes = require("./routes/need.routes");
const volunteerApplicationRoutes = require("./routes/volunteerApplication.routes");
const contributionRoutes = require("./routes/contribution.routes");
const matchingRoutes = require("./routes/matching.routes");
const adminRoutes = require("./routes/admin.routes");
const engagementContactRoutes = require("./routes/engagementContact.routes");
const notificationRoutes = require("./routes/notification.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "NGO Connect API is running",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/ngos", ngoRoutes);
app.use("/api/causes", causeRoutes);
app.use("/api/skills", skillRoutes);
app.use("/api/needs", needRoutes);
app.use("/api", volunteerApplicationRoutes);
app.use("/api", contributionRoutes);
app.use("/api/engagements", engagementContactRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/matching", matchingRoutes);
app.use("/api/admin", adminRoutes);

app.use(errorHandler);

module.exports = app;
