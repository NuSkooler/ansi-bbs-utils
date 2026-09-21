'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseDeviceAttributes } = require('../lib/device_attrs');

test('CTerm: "CTerm" prefix then the revision with dots as semicolons', () => {
    assert.deepEqual(parseDeviceAttributes('67;84;101;114;109;1;332'), {
        client : 'cterm', version : '1.332', ctermVersion : '1.332',
    });
    assert.deepEqual(parseDeviceAttributes('67;84;101;114;109;1;326'), {
        client : 'cterm', version : '1.326', ctermVersion : '1.326',
    });
});

test('CTerm: a fork appends components rather than incrementing', () => {
    assert.deepEqual(parseDeviceAttributes('67;84;101;114;109;1;332;7'), {
        client : 'cterm', version : '1.332.7', ctermVersion : '1.332.7',
    });
});

test('CTerm: prefix alone or a non-numeric revision gives no version', () => {
    assert.deepEqual(parseDeviceAttributes('67;84;101;114;109'), {
        client : 'cterm', version : null, ctermVersion : null,
    });
    assert.deepEqual(parseDeviceAttributes('67;84;101;114;109;1;x'), {
        client : 'cterm', version : null, ctermVersion : null,
    });
    assert.deepEqual(parseDeviceAttributes('67;84;101;114;109;01'), {
        client : 'cterm', version : null, ctermVersion : null,
    }, 'leading zeros are not a revision number');
});

test('CTerm: the prefix must be whole', () => {
    assert.equal(parseDeviceAttributes('67;84;101;114;1090').client, null);
    assert.equal(parseDeviceAttributes('67;84;101;114').client, null);
});

test('IcyTerm: "IcyTerm" prefix then version; no CTerm revision', () => {
    assert.deepEqual(parseDeviceAttributes('73;99;121;84;101;114;109;0;8;4'), {
        client : 'icy_term', version : '0.8.4', ctermVersion : null,
    });
    assert.deepEqual(parseDeviceAttributes('73;99;121;84;101;114;109'), {
        client : 'icy_term', version : null, ctermVersion : null,
    });
});

test('exact matches: VTX and Arctel', () => {
    assert.deepEqual(parseDeviceAttributes('50;86;84;88'), {
        client : 'vtx', version : null, ctermVersion : null,
    });
    assert.deepEqual(parseDeviceAttributes('63;1;2'), {
        client : 'arctel', version : null, ctermVersion : null,
    });
});

test('unknown and empty replies', () => {
    const none = { client : null, version : null, ctermVersion : null };

    assert.deepEqual(parseDeviceAttributes('1;2'), none);          //  VT100
    assert.deepEqual(parseDeviceAttributes('62;1;2;6;7;8;9'), none);
    assert.deepEqual(parseDeviceAttributes(''), none);
    assert.deepEqual(parseDeviceAttributes(undefined), none);
    assert.deepEqual(parseDeviceAttributes(42), none);
});
