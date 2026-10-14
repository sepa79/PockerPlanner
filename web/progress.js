"use strict";

window.PocketProgress = activities => activities.length
  ? Math.round(activities.reduce((total, activity) => total + activity.progress, 0) / activities.length)
  : null;
