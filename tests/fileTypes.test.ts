/**
 * 文件类型配置和扩展名处理的测试。
 * 验证：
 * 1. accept 属性生成正确包含大小写变体和 MIME 类型
 * 2. 文件扩展名检测大小写不敏感
 * 3. 导出文件名标准化
 */
import { describe, it, expect } from 'vitest';
import {
  buildAccept,
  hasExtension,
  isSkeletonFile,
  isImageFile,
  isBinarySkeletonFile,
  isProjectFile,
  isAtlasFile,
  baseName,
  normalizeExportFilename,
  ACCEPT_OPEN_PROJECT,
  ACCEPT_IMPORT_DATA,
  ACCEPT_IMPORT_ASSET,
  ACCEPT_PLUGIN,
  ACCEPT_REFERENCE_IMAGE,
  FILE_EXTENSIONS,
} from '../src/ui/fileTypes';

describe('buildAccept', () => {
  it('includes lowercase extensions', () => {
    const result = buildAccept(['json', 'png']);
    expect(result).toContain('.json');
    expect(result).toContain('.png');
  });

  it('includes uppercase extensions', () => {
    const result = buildAccept(['json', 'png']);
    expect(result).toContain('.JSON');
    expect(result).toContain('.PNG');
  });

  it('includes MIME types', () => {
    const result = buildAccept(['json', 'png']);
    expect(result).toContain('application/json');
    expect(result).toContain('image/png');
  });

  it('deduplicates MIME types for jpeg variants', () => {
    const result = buildAccept(['jpg', 'jpeg']);
    const parts = result.split(',');
    const jpegMimeCount = parts.filter((p) => p === 'image/jpeg').length;
    expect(jpegMimeCount).toBe(1);
  });

  it('handles dbbin extension correctly', () => {
    const result = buildAccept(['dbbin']);
    expect(result).toContain('.dbbin');
    expect(result).toContain('.DBBIN');
    expect(result).toContain('application/octet-stream');
  });
});

describe('ACCEPT constants', () => {
  it('ACCEPT_OPEN_PROJECT includes all skeleton types', () => {
    expect(ACCEPT_OPEN_PROJECT).toContain('.json');
    expect(ACCEPT_OPEN_PROJECT).toContain('.JSON');
    expect(ACCEPT_OPEN_PROJECT).toContain('.dbbin');
    expect(ACCEPT_OPEN_PROJECT).toContain('.DBBIN');
    expect(ACCEPT_OPEN_PROJECT).toContain('.dbproj');
    expect(ACCEPT_OPEN_PROJECT).toContain('.DBPROJ');
  });

  it('ACCEPT_OPEN_PROJECT includes image types', () => {
    expect(ACCEPT_OPEN_PROJECT).toContain('.png');
    expect(ACCEPT_OPEN_PROJECT).toContain('.PNG');
    expect(ACCEPT_OPEN_PROJECT).toContain('.jpg');
    expect(ACCEPT_OPEN_PROJECT).toContain('.jpeg');
    expect(ACCEPT_OPEN_PROJECT).toContain('.webp');
  });

  it('ACCEPT_OPEN_PROJECT includes atlas', () => {
    expect(ACCEPT_OPEN_PROJECT).toContain('.atlas');
    expect(ACCEPT_OPEN_PROJECT).toContain('.ATLAS');
  });

  it('ACCEPT_IMPORT_DATA includes skeleton types only', () => {
    expect(ACCEPT_IMPORT_DATA).toContain('.json');
    expect(ACCEPT_IMPORT_DATA).toContain('.dbbin');
    expect(ACCEPT_IMPORT_DATA).toContain('.dbproj');
    expect(ACCEPT_IMPORT_DATA).not.toContain('.png');
    expect(ACCEPT_IMPORT_DATA).not.toContain('.atlas');
  });

  it('ACCEPT_IMPORT_ASSET includes only PNG', () => {
    expect(ACCEPT_IMPORT_ASSET).toContain('.png');
    expect(ACCEPT_IMPORT_ASSET).toContain('.PNG');
    expect(ACCEPT_IMPORT_ASSET).toContain('image/png');
    expect(ACCEPT_IMPORT_ASSET).not.toContain('.jpg');
  });

  it('ACCEPT_PLUGIN includes plugin file types', () => {
    expect(ACCEPT_PLUGIN).toContain('.json');
    expect(ACCEPT_PLUGIN).toContain('.js');
    expect(ACCEPT_PLUGIN).toContain('.mjs');
    expect(ACCEPT_PLUGIN).toContain('text/javascript');
  });

  it('ACCEPT_REFERENCE_IMAGE includes common image types', () => {
    expect(ACCEPT_REFERENCE_IMAGE).toContain('.png');
    expect(ACCEPT_REFERENCE_IMAGE).toContain('.jpg');
    expect(ACCEPT_REFERENCE_IMAGE).toContain('.jpeg');
    expect(ACCEPT_REFERENCE_IMAGE).toContain('.webp');
    expect(ACCEPT_REFERENCE_IMAGE).toContain('.gif');
    expect(ACCEPT_REFERENCE_IMAGE).toContain('.bmp');
  });
});

describe('hasExtension', () => {
  it('matches lowercase extension', () => {
    expect(hasExtension('file.json', ['json'])).toBe(true);
    expect(hasExtension('file.dbbin', ['dbbin'])).toBe(true);
  });

  it('matches uppercase extension (case insensitive)', () => {
    expect(hasExtension('file.JSON', ['json'])).toBe(true);
    expect(hasExtension('file.DBBIN', ['dbbin'])).toBe(true);
  });

  it('matches mixed case extension', () => {
    expect(hasExtension('file.Json', ['json'])).toBe(true);
    expect(hasExtension('file.DbBin', ['dbbin'])).toBe(true);
  });

  it('returns false for non-matching extension', () => {
    expect(hasExtension('file.txt', ['json', 'png'])).toBe(false);
  });

  it('handles files without extension', () => {
    expect(hasExtension('filename', ['json'])).toBe(false);
  });
});

describe('file type detection functions', () => {
  describe('isSkeletonFile', () => {
    it('detects JSON files', () => {
      expect(isSkeletonFile('skeleton_ske.json')).toBe(true);
      expect(isSkeletonFile('SKELETON.JSON')).toBe(true);
    });

    it('detects DBBIN files', () => {
      expect(isSkeletonFile('skeleton_ske.dbbin')).toBe(true);
      expect(isSkeletonFile('SKELETON.DBBIN')).toBe(true);
    });

    it('detects DBPROJ files', () => {
      expect(isSkeletonFile('project.dbproj')).toBe(true);
      expect(isSkeletonFile('PROJECT.DBPROJ')).toBe(true);
    });

    it('rejects non-skeleton files', () => {
      expect(isSkeletonFile('texture.png')).toBe(false);
      expect(isSkeletonFile('atlas.atlas')).toBe(false);
    });
  });

  describe('isImageFile', () => {
    it('detects PNG files', () => {
      expect(isImageFile('texture.png')).toBe(true);
      expect(isImageFile('TEXTURE.PNG')).toBe(true);
    });

    it('detects JPG/JPEG files', () => {
      expect(isImageFile('photo.jpg')).toBe(true);
      expect(isImageFile('photo.jpeg')).toBe(true);
      expect(isImageFile('PHOTO.JPG')).toBe(true);
    });

    it('detects WebP files', () => {
      expect(isImageFile('image.webp')).toBe(true);
      expect(isImageFile('IMAGE.WEBP')).toBe(true);
    });

    it('rejects non-image files', () => {
      expect(isImageFile('skeleton.json')).toBe(false);
      expect(isImageFile('data.dbbin')).toBe(false);
    });
  });

  describe('isBinarySkeletonFile', () => {
    it('detects dbbin files', () => {
      expect(isBinarySkeletonFile('skeleton.dbbin')).toBe(true);
      expect(isBinarySkeletonFile('SKELETON.DBBIN')).toBe(true);
      expect(isBinarySkeletonFile('file.Dbbin')).toBe(true);
    });

    it('rejects non-dbbin files', () => {
      expect(isBinarySkeletonFile('skeleton.json')).toBe(false);
      expect(isBinarySkeletonFile('skeleton.dbproj')).toBe(false);
    });
  });

  describe('isProjectFile', () => {
    it('detects dbproj files', () => {
      expect(isProjectFile('project.dbproj')).toBe(true);
      expect(isProjectFile('PROJECT.DBPROJ')).toBe(true);
    });

    it('rejects non-dbproj files', () => {
      expect(isProjectFile('skeleton.json')).toBe(false);
      expect(isProjectFile('skeleton.dbbin')).toBe(false);
    });
  });

  describe('isAtlasFile', () => {
    it('detects atlas files', () => {
      expect(isAtlasFile('texture.atlas')).toBe(true);
      expect(isAtlasFile('TEXTURE.ATLAS')).toBe(true);
    });

    it('rejects non-atlas files', () => {
      expect(isAtlasFile('texture.json')).toBe(false);
      expect(isAtlasFile('texture.png')).toBe(false);
    });
  });
});

describe('baseName', () => {
  it('removes extension from filename', () => {
    expect(baseName('file.json')).toBe('file');
    expect(baseName('skeleton_ske.dbbin')).toBe('skeleton_ske');
    expect(baseName('project.name.dbproj')).toBe('project.name');
  });

  it('handles filename without extension', () => {
    expect(baseName('filename')).toBe('filename');
  });

  it('handles empty string', () => {
    expect(baseName('')).toBe('');
  });
});

describe('normalizeExportFilename', () => {
  it('adds extension if missing', () => {
    expect(normalizeExportFilename('myproject', 'json')).toBe('myproject.json');
    expect(normalizeExportFilename('skeleton', 'dbbin')).toBe('skeleton.dbbin');
  });

  it('preserves correct extension', () => {
    expect(normalizeExportFilename('myproject.json', 'json')).toBe('myproject.json');
    expect(normalizeExportFilename('skeleton.dbbin', 'dbbin')).toBe('skeleton.dbbin');
  });

  it('normalizes uppercase to lowercase extension', () => {
    expect(normalizeExportFilename('myproject.JSON', 'json')).toBe('myproject.json');
    expect(normalizeExportFilename('skeleton.DBBIN', 'dbbin')).toBe('skeleton.dbbin');
  });

  it('replaces known wrong extension with correct one', () => {
    expect(normalizeExportFilename('skeleton.json', 'dbbin')).toBe('skeleton.dbbin');
    expect(normalizeExportFilename('skeleton.png', 'json')).toBe('skeleton.json');
  });

  it('appends extension for unknown extensions', () => {
    expect(normalizeExportFilename('myproject.txt', 'json')).toBe('myproject.txt.json');
    expect(normalizeExportFilename('data.unknown', 'dbbin')).toBe('data.unknown.dbbin');
  });

  it('does not add duplicate extension', () => {
    expect(normalizeExportFilename('project.json.json', 'json')).toBe('project.json.json');
    expect(normalizeExportFilename('project.dbbin', 'dbbin')).toBe('project.dbbin');
  });

  it('handles filenames with dots in the name', () => {
    expect(normalizeExportFilename('my.project.v2', 'json')).toBe('my.project.v2.json');
    expect(normalizeExportFilename('project.final.json', 'json')).toBe('project.final.json');
  });
});

describe('FILE_EXTENSIONS constant', () => {
  it('skeleton includes expected types', () => {
    expect(FILE_EXTENSIONS.skeleton).toContain('json');
    expect(FILE_EXTENSIONS.skeleton).toContain('dbbin');
    expect(FILE_EXTENSIONS.skeleton).toContain('dbproj');
  });

  it('image includes expected types', () => {
    expect(FILE_EXTENSIONS.image).toContain('png');
    expect(FILE_EXTENSIONS.image).toContain('jpg');
    expect(FILE_EXTENSIONS.image).toContain('jpeg');
    expect(FILE_EXTENSIONS.image).toContain('webp');
  });

  it('plugin includes expected types', () => {
    expect(FILE_EXTENSIONS.plugin).toContain('json');
    expect(FILE_EXTENSIONS.plugin).toContain('js');
    expect(FILE_EXTENSIONS.plugin).toContain('mjs');
  });
});
