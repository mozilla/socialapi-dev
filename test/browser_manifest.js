Cu.import("resource://socialdev/modules/registry.js");
Cu.import("resource://gre/modules/Services.jsm");

function test() {
  runTests(tests);
}

function doValidationTest(location, rawManifest, cb) {
  let r = registry();
  let origin = Services.io.newURI(location, null, null).prePath;
  try {
    let manifest = r.manifestRegistry.validateManifest(location, rawManifest);
    cb(manifest);
  } catch(e) {
    info("validation exception "+e.toString());
    cb(undefined);
  }
}

let tests = {
  testManifestOK: function (cbnext) {
    doValidationTest("https://example.com/app.manifest",{
      "services": {
        "social": {
          "name": "Test GOOD Provider",
          "iconURL": "icon.png",
          "workerURL": "worker.js",
          "sidebarURL": "sidebar.htm",
        }
      }
    }, function callback(manifest) {
      isnot(manifest, undefined, "manifest validated");
      cbnext();
    });
  },
  testManifestSameOriginFail: function (cbnext) {
    doValidationTest("https://example.com/app.manifest",{
      "services": {
        "social": {
          "name": "Test BAD Provider",
          "iconURL": "icon.png",
          "workerURL": "http://example.com/worker.js",
          "sidebarURL": "http://example.com/sidebar.htm",
        }
      }
    }, function callback(manifest) {
      is(manifest, undefined, "manifest validation with bad origin should fail");
      cbnext();
    });
  }
};
