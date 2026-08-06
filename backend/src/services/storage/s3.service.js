const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const { s3Client } = require('../../config/s3');
const env = require('../../config/env');

function buildKey({ orgId, projectId, ownerId, filename }) {
  const scopeSegment = projectId ? `project-${projectId}` : `personal-${ownerId}`;
  return `orgs/${orgId}/${scopeSegment}/${uuidv4()}-${filename}`;
}

function buildAvatarKey({ userId, filename }) {
  return `avatars/${userId}/${uuidv4()}-${filename}`;
}

async function uploadBuffer({ key, buffer, mimeType }) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.s3BucketName,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })
  );
  return key;
}

async function getObjectBuffer(key) {
  const result = await s3Client.send(new GetObjectCommand({ Bucket: env.s3BucketName, Key: key }));
  const chunks = [];
  for await (const chunk of result.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function getSignedDownloadUrl(key, expiresIn = 300) {
  const command = new GetObjectCommand({ Bucket: env.s3BucketName, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn });
}

module.exports = { buildKey, buildAvatarKey, uploadBuffer, getObjectBuffer, getSignedDownloadUrl };
