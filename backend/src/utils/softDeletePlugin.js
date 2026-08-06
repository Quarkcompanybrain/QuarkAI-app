const { Schema } = require('mongoose');

/**
 * Adds deletedAt/deletedBy to a schema and makes all `find` queries
 * exclude soft-deleted documents by default. Pass { includeDeleted: true }
 * in query options to bypass.
 */
function softDeletePlugin(schema) {
  schema.add({
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  });

  const findMiddleware = function (next) {
    if (this.getOptions().includeDeleted) return next();
    this.where({ deletedAt: null });
    next();
  };

  schema.pre('find', findMiddleware);
  schema.pre('findOne', findMiddleware);
  schema.pre('countDocuments', findMiddleware);

  schema.methods.softDelete = function (userId) {
    this.deletedAt = new Date();
    this.deletedBy = userId;
    return this.save();
  };
}

module.exports = { softDeletePlugin };
