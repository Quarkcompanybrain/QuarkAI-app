const { S3Client } = require('@aws-sdk/client-s3');
const env = require('./env');

const s3Client = new S3Client({
  region: env.awsRegion,
  credentials: env.awsAccessKeyId
    ? { accessKeyId: env.awsAccessKeyId, secretAccessKey: env.awsSecretAccessKey }
    : undefined,
});

module.exports = { s3Client };
