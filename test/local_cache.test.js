'use strict';

const fs = require('mz/fs');
const path = require('path');
const rimraf = require('rimraf');
const assert = require('assert');
const URL = require('../lib/url');
const LocalCache = require('../lib/local_cache');

describe('test/local_cache.test.js', () => {
  after(() => {
    rimraf.sync(path.join(__dirname, './tmp'));
  });

  it('should mkdir if not exists', () => {
    const localCacheDir = path.join(__dirname, './tmp/xxx');
    new LocalCache({ localCacheDir });
    const isExists = fs.existsSync(localCacheDir);
    assert(isExists);
  });

  it('should write & load ok', () => {
    const localCacheDir = path.join(__dirname, './tmp/dubbo_registry_cache');
    const localCache = new LocalCache({ localCacheDir });
    const url = new URL({
      protocol: 'consumer',
      host: '127.0.0.1',
      path: 'com.test.TestService',
      parameters: {
        category: 'providers,configurators,routers',
        methods: '*',
        side: 'consumer',
        interface: 'com.test.TestService',
        version: '1.0.0',
      },
    });

    const value = [
      'dubbo://127.0.0.1:12200/com.test.TestService?application=test&dubbo=2.5.3&check=false&pid=42950&protocol=dubbo&revision=1.0.0&timestamp=1488263528423&anyhost=true&codec=dubbo&methods=*&side=provider&threads=200&interface=com.test.TestService&version=1.0.0&group=',
      'dubbo://127.0.0.2:12200/com.test.TestService?application=test&dubbo=2.5.3&check=false&pid=42950&protocol=dubbo&revision=1.0.0&timestamp=1488263528423&anyhost=true&codec=dubbo&methods=*&side=provider&threads=200&interface=com.test.TestService&version=1.0.0&group=',
    ];
    localCache.write(url, value);

    const map = localCache.loadAll();
    assert(map.size === 1);
    assert(map.has(url.serviceKey));
    assert.deepEqual(map.get(url.serviceKey), { url, value });
  });
});
