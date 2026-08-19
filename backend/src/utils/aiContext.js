function currentUtcDateTimeContext() {
  return `\n\nCurrent server date and time: ${new Date().toISOString()} (UTC).`;
}

module.exports = { currentUtcDateTimeContext };
