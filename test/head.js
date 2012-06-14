Cu.import("resource://gre/modules/Services.jsm");

// This is the path to the test provider relative to its origin.
const TEST_PROVIDER_PATH = "/browser/browser/features/socialapi/test/testprovider"

// See http://mxr.mozilla.org/mozilla-central/source/build/pgo/server-locations.txt
// for other possibly origins we could use.
const TEST_PROVIDER_ORIGIN = "https://example.com";
const TEST_PROVIDER_MANIFEST = TEST_PROVIDER_ORIGIN + TEST_PROVIDER_PATH + "/app.manifest";

// Some tests use 2 providers - it really is the same provider but served from
// a different origin.
const TEST_PROVIDER2_ORIGIN = "https://test1.example.com"
const TEST_PROVIDER2_MANIFEST = TEST_PROVIDER2_ORIGIN + TEST_PROVIDER_PATH + "/app.manifest";


let headModules = {}
Cu.import("resource://socialapi/modules/ProviderRegistry.jsm", headModules);
Cu.import("resource://socialapi/modules/Discovery.jsm", headModules);
Cu.import("resource://socialapi/modules/Provider.jsm", headModules);
try {
  headModules.SetProviderFactory(function(manifest) {return new headModules.SocialProvider(manifest);});
} catch (ex) {
  if (ex.toString() != "Error: already initialized") {
    info("Unexpected failure to initialize the registry: " + ex)
    throw ex;
  }
  // it's already been done...
}

function installTestProvider(callback, manifestUrl) {
  if (!manifestUrl) {
    manifestUrl = TEST_PROVIDER_MANIFEST;
  }
  let ms = headModules.SocialProviderDiscovery;
  ms.loadManifest(window.document, manifestUrl, true,
                  function() {if (callback) executeSoon(callback)});
}

function removeProvider(origin, cb) {
  headModules.registry().remove(origin, function() {
    if (cb) executeSoon(cb);
  });
}

function resetPrefs() {
  let prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);
  prefBranch.deleteBranch('');
  let tmp = {};
  Cu.import("resource://socialapi/modules/defaultprefs.js", tmp);
  tmp.setDefaultPrefs();
}

function resetSocial() {
  // ACK - this is most useful via registerCleanupFunction, but it doesn't
  // have a concept of async - so no callback arg.
  // reset the entire social world back to the state it is on a "clean" first
  // startup - ie, all UI elements and prefs.
  let r = headModules.registry();
  if (isSidebarVisible()) {
    window.social_sidebar_toggle();
  };
  r.enabled = false;
  // all providers get nuked. - we reach into the impl here...
  let providers = r._providers;
  let origins = Object.keys(providers); // take a copy as we are mutating it
  for each (let origin in origins) {
    r.remove(origin);
  }
  resetPrefs();
  info("social was reset to the default state"); // well, in theory anyway :)
}

// ALL tests here want a clean state.
registerCleanupFunction(resetSocial);


// a helper for checking observer notifications.
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

  check: function(expected, message) {
    if (this.observed.length != expected.length) {
      dump("observer check failed for "+(message?message:"?")+" - got topics " + [o.topic for each (o in this.observed)].join(", ") +
           " - expected " + [o.topic for each (o in expected)].join(", ") + "\n");
    }
    is(this.observed.length, expected.length, "check expected number of observations");
    for (let i = 0; i < expected.length; i++) {
      let obtopic = this.observed[i] ? this.observed[i].topic : "<nothing observed>";
      is(obtopic, expected[i].topic, "check observation " + i);
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
function runTests(tests, cbPreTest, cbPostTest) {
  resetPrefs(); // all tests want the default prefs to start.
  waitForExplicitFinish();
  let testIter = Iterator(tests);

  if (cbPreTest === undefined) {
    cbPreTest = function(cb) {cb()};
  }
  if (cbPostTest === undefined) {
    cbPostTest = function(cb) {cb()};
  }

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
      function cleanupAndRunNextTest() {
        info("sub-test " + name + " complete");
        cbPostTest(runNextTest);
      }
      cbPreTest(function() {
        info("sub-test " + name + " starting");
        try {
          func.call(tests, cleanupAndRunNextTest);
        } catch (ex) {
          ok(false, "sub-test " + name + " failed: " + ex.toString() +"\n"+ex.stack);
          cleanupAndRunNextTest();
        }
      })
    }, 0)
  }
  runNextTest();
}

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
    // hmph - the timing of these events is hard to predict - if we are just
    // being told about about:blank, wait until the real one comes.
    if (browser.contentWindow.location.href == "about:blank") {
      return;
    };
    browser.removeEventListener("DOMContentLoaded", browserlistener, true);
    // let the world initialize correctly - grab the worker and by the time
    // it responds to a ping it should be good to go.
    let worker = browser.contentWindow.wrappedJSObject.navigator.mozSocial.getWorker();
    worker.port.onmessage = function(evt) {
      if (evt.data.topic == "testing.pong") {
        callback(browser.contentWindow, worker);
      }
    }
    worker.port.postMessage({topic: "testing.ping"});
  }, true);
  window.social_sidebar_toggle();
}
