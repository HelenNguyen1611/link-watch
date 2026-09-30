import {
	GetObjectCommand,
	NoSuchKey,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";
import {
	LINK_SNAPSHOT_KEY,
	type SnapshotStore,
} from "@linkwatch/core/usecases";

/** Step 19b: the links snapshot as one private S3 object. */
export function s3SnapshotStore(s3: S3Client, bucket: string): SnapshotStore {
	return {
		read: async () => {
			try {
				const res = await s3.send(
					new GetObjectCommand({ Bucket: bucket, Key: LINK_SNAPSHOT_KEY }),
				);
				return (await res.Body?.transformToString("utf-8")) ?? null;
			} catch (err) {
				if (
					err instanceof NoSuchKey ||
					(err as { name?: string }).name === "NoSuchKey"
				)
					return null;
				throw err;
			}
		},
		write: async (body) => {
			await s3.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: LINK_SNAPSHOT_KEY,
					Body: body,
					ContentType: "application/json",
				}),
			);
		},
	};
}
