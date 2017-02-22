'use strict';

const assert = require('assert');
const URL = require('../lib/url');

describe('test/url.test.js', () => {
  it('should new URL ok', () => {
    const url = new URL({
      protocol: 'dubbo',
      host: '127.0.0.1',
      port: 9999,
      path: null,
      parameters: null,
    });
    assert(url.auth === null);
    url.auth = 'test-username:test-password';
    assert(url.username === 'test-username');
    assert(url.password === 'test-password');
    assert(url.auth === 'test-username:test-password');
    url.auth = null;
    assert(url.auth === 'test-username:test-password');
    url.auth = 'username';
    assert(url.auth === 'username:');
    url.auth = ':password';
    assert(url.auth === ':password');
    assert(url.address === '127.0.0.1:9999');
    url.port = 0;
    assert(url.address === '127.0.0.1');
    assert(url.toIdentityString() === 'dubbo://127.0.0.1');
    assert(url.serviceKey === null);
    url.path = 'xxx';
    assert(url.serviceKey === 'xxx');
    url.parameters.group = 'yyy';
    assert(url.serviceKey === 'yyy/xxx');
    url.parameters.version = '1.0.0';
    assert(url.serviceKey === 'yyy/xxx:1.0.0');
    assert(url.getParameter('group') === 'yyy');
    assert(url.getParameter('version') === '1.0.0');

    const newUrl = url.addParameter('foo', 'bar');
    assert(newUrl && newUrl !== url);
    assert(newUrl.getParameter('foo') === 'bar');
    assert(newUrl.getParameter('not-exist', 'default-value') === 'default-value');

    const newUrl2 = url.addParameter({
      key: 'value',
    });
    assert(newUrl2.getParameter('key') === 'value');
    assert(newUrl2.protocol === url.protocol);
    assert(newUrl2.host === url.host);
    assert(newUrl2.port === url.port);
  });

  it('should URL.valueOf ok', () => {
    const url = URL.valueOf('dubbo://127.0.0.1:12200/com.gxc.demo.DemoService?anyhost=true&application=xxx&codec=hsf&dubbo=2.5.3&interface=com.gxc.demo.DemoService&methods=sayHello&pid=41982&revision=1.0.0&side=provider&threads=200&timestamp=1487580276186&version=1.0.0');
    assert(url.host === '127.0.0.1');
    assert(url.port === 12200);
    assert(url.path === 'com.gxc.demo.DemoService');
    assert(url.getParameter('anyhost') === 'true');
    assert(url.getParameter('application') === 'xxx');
  });
});
