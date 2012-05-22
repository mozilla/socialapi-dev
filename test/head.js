Cu.import("resource://socialdev/modules/registry.js");
Cu.import("resource://gre/modules/Services.jsm");

// See http://mxr.mozilla.org/mozilla-central/source/build/pgo/server-locations.txt
// for other possibly origins we could use.
// XXX - see bug 756021 - this origin is almost certainly wrong - it should
// include the protocol and port.
const TEST_PROVIDER_ORIGIN = "http://mochi.test:8888";
var TEST_PROVIDER_MANIFEST = TEST_PROVIDER_ORIGIN + "/browser/browser/features/socialdev/test/testprovider/app.manifest";

// Helpers for the sidebar.
function isSidebarVisible() {
  return document.getElementById("social-vbox").getAttribute("hidden") != "true";
}

function openSidebar(callback) {
  // Opens the sidebar and after it loads calls the callback.
  // It is the caller's job to ensure a provider is installed etc.
  if (isSidebarVisible()) {
    throw new Error("sidebar is already visible");
  }
  // attach a load listener to the browser
  let browser = document.getElementById("social-status-sidebar-browser");
  browser.addEventListener("DOMContentLoaded", function browserlistener(evt) {
    browser.removeEventListener("DOMContentLoaded", browserlistener, true);
    callback(browser.contentWindow);
  }, true);
  window.social_sidebar_toggle();
}

function resetPrefs() {
  let prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);
  prefBranch.deleteBranch('');
  let tmp = {};
  Cu.import("resource://socialdev/modules/defaultprefs.js", tmp);
  tmp.setDefaultPrefs();
}

// Helpers for the "test provider"
function readManifestFromChrome(url) {
  let ioService = Cc["@mozilla.org/network/io-service;1"]
                  .getService(Ci.nsIIOService);
  let uri = ioService.newURI(url, null, null);
  let channel = ioService.newChannelFromURI(uri);
  let stream = channel.open();
  let sis = Cc["@mozilla.org/scriptableinputstream;1"]
            .createInstance(Ci.nsIScriptableInputStream);
  sis.init(stream);
  let data = "";
  while (true) {
    let chunk = sis.read(512);
    if (chunk.length == 0) {
        break;
    }
    data = data + chunk;
  }  
  return data;
}

function installTestProvider(callback) {
  // for now we just load the manifest directly from a chrome:// URL then
  // insert it into the manifest DB.  This is done mainly to avoid having
  // the registry grow callbacks to tell us when it has been done.
  let manifesturl = "chrome://mochitests/content/browser/browser/features/socialdev/test/testprovider/app.manifest";
  let manifest = JSON.parse(readManifestFromChrome(manifesturl));
  registry().manifestRegistry.importManifest(window.document, TEST_PROVIDER_MANIFEST, manifest, true, callback);
}

function removeTestProvider() {
// avoid test failure due to: leaked window property: ManifestDB
  let module = {}
  Cu.import("resource://socialdev/modules/manifestDB.jsm", module);
  let ManifestDB = module.ManifestDB;
  ManifestDB.remove(TEST_PROVIDER_ORIGIN, function() {});
}

// a helpers for checking observer notifications.
function observerChecker(topics) {
  this.topics = topics;
  for each (let topic in topics) {
    Services.obs.addObserver(this, topic, false);
  }
  this.observed = [];
}

observerChecker.prototype = {
  terminate: function() {
    for each (let topic in this.topics) {
      Services.obs.removeObserver(this, topic);
    }
    this.observed = null;
  },

  observe: function(aSubject, aTopic, aData) {
    this.observed.push({subject: aSubject, topic: aTopic, data: aData});
  },

  check: function(expected) {
    if (this.observed.length != expected.length) {
      dump("observer check failed - got topics " + [o.topic for each (o in this.observed)].join(", ") +
           " - expected " + [o.topic for each (o in expected)].join(", ") + "\n");
    }
    is(this.observed.length, expected.length, "check expected number of observations");
    for (let i = 0; i < expected.length; i++) {
      is(this.observed[i].topic, expected[i].topic, "check observation " + i);
      // todo: add subject etc checks?
    }
    this.observed = [];
  }
}

// A helper to run a suite of tests.
// The "test object" should be an object with function names as keys and a
// function as the value.  The functions will be called with a "cbnext" param
// which should be called when the test is complete.
// eg:
// test = {
//   foo: function(cbnext) {... cbnext();}
// }
function runTests(tests) {
  resetPrefs(); // all tests want the default prefs
  waitForExplicitFinish();
  let testIter = Iterator(tests);

  let runNextTest = function() {
    let name, func;
    try {
      [name, func] = testIter.next();
    } catch (err if err instanceof StopIteration) {
      // out of items:
      finish();
      return;
    }
    // We run on a timeout as the frameworker also makes use of timeouts, so
    // this helps keep the debug messages sane.
    window.setTimeout(function() {
      info("running test worker " + name);
      try {
        func(function() {
          ok(true, "worker test " + name + " passed");
          runNextTest();
        });
      } catch (ex) {
        ok(false, "worker test " + name + " failed: " + ex.toString());
        runNextTest();
      }
    }, 0)
  }
  runNextTest();
}

