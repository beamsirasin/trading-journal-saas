import { describe, expect, it } from 'vitest';

import {
  buildChartAttachmentStorageKey,
  contentTypeForStorageKey,
  detectImageSignature,
  isChartAttachmentContentType,
  isValidChartAttachmentStorageKey,
  workspaceIdFromStorageKey,
} from './chart-attachment';

const WORKSPACE_ID = '018f0000-0000-7000-8000-000000000001';
const OBJECT_ID = '018f0000-0000-7000-8000-000000000002';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG_SIGNATURE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP_SIGNATURE = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe('isChartAttachmentContentType', () => {
  it('accepts exactly the three supported raster image types', () => {
    expect(isChartAttachmentContentType('image/png')).toBe(true);
    expect(isChartAttachmentContentType('image/jpeg')).toBe(true);
    expect(isChartAttachmentContentType('image/webp')).toBe(true);
  });

  it('rejects an unsupported or spoofable content type, including SVG and GIF', () => {
    expect(isChartAttachmentContentType('image/svg+xml')).toBe(false);
    expect(isChartAttachmentContentType('image/gif')).toBe(false);
    expect(isChartAttachmentContentType('application/pdf')).toBe(false);
    expect(isChartAttachmentContentType('text/html')).toBe(false);
    expect(isChartAttachmentContentType('')).toBe(false);
  });
});

describe('detectImageSignature', () => {
  it('detects a real PNG signature', () => {
    expect(detectImageSignature(PNG_SIGNATURE)).toBe('image/png');
  });

  it('detects a real JPEG signature', () => {
    expect(detectImageSignature(JPEG_SIGNATURE)).toBe('image/jpeg');
  });

  it('detects a real WEBP (RIFF/WEBP) signature', () => {
    expect(detectImageSignature(WEBP_SIGNATURE)).toBe('image/webp');
  });

  it('returns null for bytes matching no known signature', () => {
    expect(detectImageSignature(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBeNull();
  });

  it('returns null for a spoofed extension whose bytes are not actually an image (e.g. an HTML/script payload)', () => {
    const fakeSvgAsPng = new TextEncoder().encode('<svg onload=alert(1)>');
    expect(detectImageSignature(fakeSvgAsPng)).toBeNull();
  });

  it('returns null for too-short input', () => {
    expect(detectImageSignature(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(detectImageSignature(new Uint8Array([]))).toBeNull();
  });
});

describe('buildChartAttachmentStorageKey / isValidChartAttachmentStorageKey', () => {
  it('builds a key matching the correct extension per content type', () => {
    expect(buildChartAttachmentStorageKey(WORKSPACE_ID, OBJECT_ID, 'image/png')).toBe(
      `trade-charts/${WORKSPACE_ID}/${OBJECT_ID}.png`,
    );
    expect(buildChartAttachmentStorageKey(WORKSPACE_ID, OBJECT_ID, 'image/jpeg')).toBe(
      `trade-charts/${WORKSPACE_ID}/${OBJECT_ID}.jpg`,
    );
    expect(buildChartAttachmentStorageKey(WORKSPACE_ID, OBJECT_ID, 'image/webp')).toBe(
      `trade-charts/${WORKSPACE_ID}/${OBJECT_ID}.webp`,
    );
  });

  it('every key this module builds is itself valid', () => {
    for (const contentType of ['image/png', 'image/jpeg', 'image/webp'] as const) {
      const key = buildChartAttachmentStorageKey(WORKSPACE_ID, OBJECT_ID, contentType);
      expect(isValidChartAttachmentStorageKey(key)).toBe(true);
    }
  });

  it('rejects a key outside the trade-charts/<workspace>/<object>.<ext> shape', () => {
    expect(isValidChartAttachmentStorageKey('trade-charts/not-a-uuid/also-not.png')).toBe(false);
    expect(isValidChartAttachmentStorageKey(`trade-charts/${WORKSPACE_ID}/${OBJECT_ID}.exe`)).toBe(
      false,
    );
    expect(isValidChartAttachmentStorageKey(`trade-charts/${WORKSPACE_ID}/${OBJECT_ID}.gif`)).toBe(
      false,
    );
    expect(isValidChartAttachmentStorageKey('../../etc/passwd')).toBe(false);
    expect(isValidChartAttachmentStorageKey('')).toBe(false);
  });

  it('rejects a user-supplied-filename-shaped key (never trusts a client filename)', () => {
    expect(isValidChartAttachmentStorageKey('trade-charts/my-vacation-photo.png')).toBe(false);
  });
});

describe('contentTypeForStorageKey', () => {
  it('derives the content type from a valid key extension', () => {
    expect(contentTypeForStorageKey(`trade-charts/${WORKSPACE_ID}/${OBJECT_ID}.png`)).toBe(
      'image/png',
    );
    expect(contentTypeForStorageKey(`trade-charts/${WORKSPACE_ID}/${OBJECT_ID}.jpg`)).toBe(
      'image/jpeg',
    );
    expect(contentTypeForStorageKey(`trade-charts/${WORKSPACE_ID}/${OBJECT_ID}.webp`)).toBe(
      'image/webp',
    );
  });

  it('returns null for an unrecognized extension', () => {
    expect(contentTypeForStorageKey(`trade-charts/${WORKSPACE_ID}/${OBJECT_ID}.exe`)).toBeNull();
  });
});

describe('workspaceIdFromStorageKey', () => {
  it('extracts the workspace segment from a valid key', () => {
    const key = buildChartAttachmentStorageKey(WORKSPACE_ID, OBJECT_ID, 'image/png');
    expect(workspaceIdFromStorageKey(key)).toBe(WORKSPACE_ID);
  });

  it('returns null for a malformed key rather than an arbitrary substring', () => {
    expect(workspaceIdFromStorageKey('not-a-real-key')).toBeNull();
    expect(workspaceIdFromStorageKey('../../etc/passwd')).toBeNull();
  });
});
