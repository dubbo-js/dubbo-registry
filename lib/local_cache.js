'use strict';

const fs = require('mz/fs');
const URL = require('./url');
const path = require('path');
const Base = require('sdk-base');
const assert = require('assert');
const mkdirp = require('mkdirp');

class LocalCache extends Base {
  constructor(options) {
    assert(options && options.localCacheDir, '[dubbo-registry] options.localCacheDir is required');
    super(options);
    mkdirp.sync(this.localCacheDir);
    this.ready(true);
  }

  get localCacheDir() {
    return this.options.localCacheDir;
  }

  loadAll() {
    const map = new Map();
    const items = fs.readdirSync(this.localCacheDir);
    for (const filename of items) {
      const filepath = path.join(this.localCacheDir, filename);
      const stat = fs.statSync(filepath);
      if (stat.isFile()) {
        const content = fs.readFileSync(filepath, 'utf8');
        try {
          const obj = JSON.parse(content.trim());
          const key = filename.replace('@', ':');
          map.set(key, {
            url: URL.valueOf(obj.url),
            value: obj.value,
          });
        } catch (err) {
          err.name = 'DubboRegistryLocalCacheLoadError';
          err.filepath = filepath;
          err.data = content;
          this.emit('error', err);
        }
      }
    }
    return map;
  }

  write(url, value) {
    const filename = url.serviceKey.replace(':', '@');
    const filepath = path.join(this.localCacheDir, filename);
    fs.writeFileSync(filepath, JSON.stringify({
      url: url.toFullString(),
      value,
    }));
  }
}

module.exports = LocalCache;
