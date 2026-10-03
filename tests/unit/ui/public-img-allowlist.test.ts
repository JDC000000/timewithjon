// pr89 F3 + Jon decision 48 (2026-09-28): public/ ships with every build, so every image in it is a reviewed file.
// This public repo holds ONLY licensed Unsplash stand-ins (docs/PHOTOS.md lists each one's source; their ICC chunk is
// dropped losslessly so they meet the dec-48 "no metadata at all" rule). Jon's own photos never enter git: a private
// build overwrites these files via scripts/fetch-real-photos.mjs (docs/PHOTOS.md). Any new or changed image fails here:
// adding one is a reviewed edit of this list.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHOTO_DIR, PHOTO_SLOTS } from '@/ui/photo-slots';

const PUBLIC = join(process.cwd(), 'public');
const IMAGE = /\.(webp|jpe?g|png|gif|avif|heic|heif|tiff?|bmp|svg|ico)$/i;

/** path under public/ -> sha256 of the committed stand-in (JONS_OWN slots are replaced by Jon's photos in private builds). */
const ALLOWED: Readonly<Record<string, string>> = {
  'img/bluebird-1200.webp': '1a60ac90b6e0b8889fb0958801f6c2e2aefe30cdcf472786a11cc74607bd6f06',
  'img/bluebird-480.webp': '74a2d88f27e144f2978c56ef13cb50bc953c674d3594e4701bc3acb1ead1fa51',
  'img/bluebird-800.webp': '7e6364dd3546cf9b9f903f6216db5a10a72e1bfa09b6ec55a594c3a4aef873e8',
  'img/catch-release-1200.webp': '8604af1cf8a377684de187f22e57a5e06de53a0fdcb4d19514bf64bbc36dba70',
  'img/catch-release-480.webp': '02041f93f4d87b6251f813ddf55020e563e6dbb6bfa57c02705f6ebc9545733d',
  'img/catch-release-800.webp': 'aec98cf182f9eac0c1aa8eca3f3451eb860fe438dbc1848099917ab452393e4b',
  'img/close-1200.webp': '213f792fbe51d09f965aba4f35d9da4dac4ded057187e181efa76df5447c0548',
  'img/close-1600.webp': '01b5e5c907a07139658f34b876b7cfa7b9eccf7f422bf4a3fae8a30cfa3d91b3',
  'img/close-480.webp': '59a16da6109698a02e4f96412144c3cc8fb3d9977f22019f8a8d436c6d6658db',
  'img/close-800.webp': '96144a5aff557f80025f21cb0d2643d0919e32cabf32030a90ef75b3d8d126d3',
  'img/day-trip-1200.webp': 'dbaf7163afa1f3667e70cf3a96f21647528b3aa190c85004c1a3a5cf26991187',
  'img/day-trip-480.webp': 'ea540f23eca19ad4f0c4ac56b5df574633d5dc77897db932e7101f3fe46dfcb1',
  'img/day-trip-800.webp': 'e204632220915053540b1a411dfee7800810fd00d016ad805879596c4e294708',
  'img/double-date-1200.webp': 'd0900c89cfd96f3aa8c4f1b12b2108ac9777f2dd5abfc2b9e19cb03cad4d1acd',
  'img/double-date-480.webp': 'f9e2500e71d7cd7737051af4a5ed6c1df79e4f909b9e753304196c6549d902c6',
  'img/double-date-800.webp': '0644db413d784cb6551277dbe9c1733bc97ee354e5777ff81836e2027e6a60b5',
  'img/encore-1200.webp': '42b3fc3dc962eaa48a04cce37c40e8800ce2f56f81cc142a149a6084abf9c2d3',
  'img/encore-480.webp': 'b390b367e3688ca0ad6cdd51ff68325a6cb99d4b4cddab808535ca86bb77737c',
  'img/encore-800.webp': 'c526980bdd3f08f9f03b98149f2d82c4061ad822d0293c6db0c86991a9efd9d0',
  'img/family-hang-1200.webp': '564559caae7abd7ca622fe573d33de1c159adf24e8e2eb661edc12dac751dd39',
  'img/family-hang-480.webp': '8d5631f089b99b82511c40db5ca9d88c8f26dfe6a7d3cf8ed8111f3e78e906e8',
  'img/family-hang-800.webp': 'c743267d712b3a03725a159365d905baac4ad55b375c5d2059200fca1f0138b5',
  'img/first-round-1200.webp': '19afb97ead35b58a88885af89f78139533e9065e10e5f6c8612d5bff34b10c04',
  'img/first-round-480.webp': '2b1d3a1c6d6c388ead448394eef4be14c18635758d99651e503eceb49453b1cc',
  'img/first-round-800.webp': '3e15c27ba2afd02898053a8e0133c0b629698754cabc9377ade4b05be9bdd5d4',
  'img/flat-white-1200.webp': '9d8e0b416ad3399a84ba7e016abd39a46dfaf9ac0b8f19f846d960d75a14c32c',
  'img/flat-white-480.webp': '60c3f5d5cb2cab2741f39467db476f3ac32843b6a316eb0a128e4d88d12ccc8c',
  'img/flat-white-800.webp': 'bddac80650d2c694df815cfe166be24fb6be93282dd03d2a715b7e0a8b6ad2e9',
  'img/grind-1200.webp': '4116c87c9466ff824dbee39e7c76ebd4d357134acab2d4f1225e69d8d86de0ef',
  'img/grind-480.webp': '72ea6353b0c0e6a46f579f724cc2bd3d84054dd26895e18dcb6507a2019503e0',
  'img/grind-800.webp': '28262ce74e99aea841478fa1193d6f3f8164f2abf7e11258f5b99c33f0a78636',
  'img/hero-1200.webp': '5ce8d86863ef75d44ca1368856b6417baf0fdb9c3e697079826e595ef1e5bae3',
  'img/hero-1600.webp': '56c222b1d984e7133963ecf9475507979129f5125e7a3c3850146e696ccbd914',
  'img/hero-480.webp': 'a0231b80503ffd7124d33ee08abfeeb2c7513cccb288238a9eb1f4d2057d995d',
  'img/hero-800.webp': '0abb0f2ba147787eb1e19454513b4c681f431dfda8b5188998e2dae7c1d414ba',
  'img/long-distance-1200.webp': '054295116e54a8b222134a01736d9c2b8ddaa53f9e1d853c17370de2917519c5',
  'img/long-distance-480.webp': 'b9b81c689a446338b37595c935110dfa7edfb9ddda7db38e5c41f3e3a16be875',
  'img/long-distance-800.webp': '6e483cca44efb8232c8c97dd84a3d00a7b3cb525cdcda6f4e8bf8ffe76a5f402',
  'img/long-lunch-1200.webp': '2bfe179448ecacef586f00c24104e713186f820c8ff6562640b72d06e35ef981',
  'img/long-lunch-480.webp': '5cbd0cd36eefee182dc50113fc0f42677cdb1d8716dcdff69c2d8ef65364e5a4',
  'img/long-lunch-800.webp': 'f19bfbf0cb15a6279d56476720b4dae48097be096226b96e291d25b760dd3614',
  'img/old-haunt-1200.webp': '19d99e08640ff38cc0095595642cb32209190b6466464d8fa04c3550068668bf',
  'img/old-haunt-480.webp': '5b7d6f2de469294cdc47cae4524f599c20f9e2f16dab5ed23b38df8e684246b6',
  'img/old-haunt-800.webp': '676e1b18e34670be508df709cd7eede289159e5c398a08eec31d03e79aca345a',
  'img/pitch-me-1200.webp': '34517713c1ac3522b81578d65a7437266538da3ddbce7952c12e73e9686f6f27',
  'img/pitch-me-480.webp': 'd6367f78b3f3bb889eeb6a83e37c0036028e891ea682fdc6aa534392a15f3ff5',
  'img/pitch-me-800.webp': 'df9f74703a946462186d52160529dd9c9ac1d5b1dc2a0f42b00501aabb82bd7a',
  'img/shore-ride-1200.webp': '6af52741add1fa9b3f32197d195173cce3d00983fd676426abc3b1991008ef57',
  'img/shore-ride-480.webp': '78e3560301c1e511b751b1b85490a04b1697ef0edd16f02296cfa471d39d65e7',
  'img/shore-ride-800.webp': '89a95614e4a0e1bc01f955e49cc8be17f2ab9316cc1d8da002f87dc83f944a46',
  'img/something-new-1200.webp': '44630db8724f88ad675ab7e589da76a49607a8d1f06ff9d2cbe8396a0bb3ffaf',
  'img/something-new-480.webp': 'ab235b1871f3c7d608770c4fe72765ac30a6b1218c71bad6304e5b27b81ec1ce',
  'img/something-new-800.webp': 'e7dc62195e32bffd9afeab7869795543fdd9170fa0692f851291eadd2cf93789',
  'img/surprise-me-1200.webp': '82df1b45e79e5254a7e438c1fcd5abc0ebfbb8f2a47e20ac812506c29f8114a1',
  'img/surprise-me-480.webp': 'be020b53973fd949a5b3bdf7bb8a398b53cc788484a93689ab89d6344a126d42',
  'img/surprise-me-800.webp': 'da53b7219d514c593fc482ab4d818a868c268170ced97b5b547b1a28ac6712db',
  'img/why-1200.webp': 'd3f7ff3d97e68c8d69cf020160ccf986d2eb6cf818db497be6d022eb4c24e373',
  'img/why-1600.webp': '0d3e22f6a1bfc902bb03e518c5f0d7b0cf78f9f3659ed1e36bb96a51c9e7c8bb',
  'img/why-480.webp': '233fa99c0d87e0efed652278578ad147111db88b2d639ddb8bbdb235f3b2ba04',
  'img/why-800.webp': 'e98efa04ad4b8061f1f88b8851f5610414de8ad00c389d1ee844e1636c02279b',
};

/** the slots Jon's own photos fill in a private build (decisions 48, 52, 53; build-real-photos.mjs SLOTS): no `credit`. */
const JONS_OWN = [
  'hero',
  'why',
  'close',
  'long-lunch',
  'shore-ride',
  'encore',
  'day-trip',
  'double-date',
  'grind',
  'first-round',
  'family-hang',
  'flat-white',
  'long-distance',
  'old-haunt',
  'catch-release',
  'bluebird',
  'surprise-me',
  'pitch-me',
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('public/ images (pr89 F3)', () => {
  const files = walk(PUBLIC).map((p) => relative(PUBLIC, p).split('\\').join('/'));
  const images = files.filter((f) => IMAGE.test(f) || f.startsWith('img/'));

  it('holds only the allowlisted stand-ins, byte for byte', () => {
    for (const f of images) {
      const sha = createHash('sha256')
        .update(readFileSync(join(PUBLIC, f)))
        .digest('hex');
      expect({ f, sha }).toEqual({ f, sha: ALLOWED[f] ?? 'not on the allowlist' });
    }
    expect(images.sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it('every file a slot points at is allowlisted; stand-ins are credited, Jon’s own (dec 48) are not', () => {
    for (const [slot, photo] of Object.entries(PHOTO_SLOTS)) {
      expect(photo.credit === undefined, slot).toBe(JONS_OWN.includes(slot));
      for (const w of photo.w)
        expect(ALLOWED[`${PHOTO_DIR.slice(1)}/${photo.file}-${w}.webp`], slot).toBeDefined();
    }
  });
});
