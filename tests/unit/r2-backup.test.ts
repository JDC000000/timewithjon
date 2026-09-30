// T3.16.05 / the storage-delete helper: the R2 adapter's delete and list, against a stubbed S3 client.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
  type DeleteObjectsCommandOutput,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { createR2Backup, R2Error, R2NotConfiguredError } from '@/lib/adapters/r2';

const CFG = { accountId: 'acc', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' };
afterEach(() => vi.restoreAllMocks());

describe('createR2Backup().remove', () => {
  it('deletes in batches of 1000 (DeleteObjects limit), quietly, from the configured bucket', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const keys = Array.from({ length: 1001 }, (_, i) => `photos/final/${i}.jpg`);
    await createR2Backup(CFG).remove(keys);
    expect(send).toHaveBeenCalledTimes(2);
    const inputs = send.mock.calls.map(([c]) => (c as DeleteObjectsCommand).input);
    expect(inputs.map((i) => i.Delete!.Objects!.length)).toEqual([1000, 1]);
    expect(inputs[0]).toMatchObject({ Bucket: 'b', Delete: { Quiet: true } });
    expect(inputs[1]!.Delete!.Objects).toEqual([{ Key: 'photos/final/1000.jpg' }]);
  });
  it('nothing to delete → no call, even unconfigured', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send');
    await createR2Backup({}).remove([]);
    expect(send).not.toHaveBeenCalled();
  });
  it('a per-key error in the answer throws (without echoing keys)', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      Errors: [{ Key: 'photos/final/secret.jpg', Code: 'AccessDenied' }],
    } as DeleteObjectsCommandOutput as never);
    const err = await createR2Backup(CFG)
      .remove(['photos/final/secret.jpg'])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(R2Error);
    expect(String((err as Error).message)).not.toContain('secret');
  });
  it('unconfigured → R2NotConfiguredError', async () => {
    await expect(createR2Backup({ ...CFG, bucket: undefined }).remove(['k'])).rejects.toBeInstanceOf(
      R2NotConfiguredError,
    );
  });
});

describe('createR2Backup().listCreatedBefore', () => {
  it('follows every page under prefix/ and keeps only keys written before the cutoff', async () => {
    const cutoff = new Date('2027-01-01T00:00:00Z');
    const before = new Date('2026-12-31T00:00:00Z');
    const after = new Date('2027-01-02T00:00:00Z');
    const pages: Partial<ListObjectsV2CommandOutput>[] = [
      {
        Contents: [{ Key: 'photos/final/a.jpg', LastModified: before }],
        IsTruncated: true,
        NextContinuationToken: 't1',
      },
      {
        Contents: [
          { Key: 'photos/final/b.jpg', LastModified: after },
          { Key: 'photos/final/c.jpg', LastModified: before },
        ],
        IsTruncated: false,
      },
    ];
    const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async () => pages.shift() as never);
    expect(await createR2Backup(CFG).listCreatedBefore('photos/final', cutoff)).toEqual([
      'photos/final/a.jpg',
      'photos/final/c.jpg',
    ]);
    const inputs = send.mock.calls.map(([c]) => (c as ListObjectsV2Command).input);
    expect(inputs).toEqual([
      { Bucket: 'b', Prefix: 'photos/final/', ContinuationToken: undefined },
      { Bucket: 'b', Prefix: 'photos/final/', ContinuationToken: 't1' },
    ]);
  });
});
