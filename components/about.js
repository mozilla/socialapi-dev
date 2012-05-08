const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://socialdev/modules/manifestDB.jsm");

const ABOUTURL = "chrome://socialdev/content/about.html";
const EXPORTED_SYMBOLS = [];

//----- about:social implementation
const AboutSocialUUID = Components.ID("{ddf3f2e0-c819-b843-b32c-c8834d98ef49}");
const AboutSocialContract = "@mozilla.org/network/protocol/about;1?what=social";

function AboutSocial() {}
AboutSocial.prototype = {
  classID: AboutSocialUUID,
  contractID: AboutSocialContract,
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIAboutModule]),

  getURIFlags: function(aURI) {
    return Ci.nsIAboutModule.ALLOW_SCRIPT;
  },

  newChannel: function(aURI) {
    let channel = Services.io.newChannel(ABOUTURL, null, null);
    channel.originalURI = aURI;
    return channel;
  }
};
//----- end about:social (but see ComponentRegistrar call in startup())


var aboutPage = {
  observe: function(aDocument, aTopic, aData) {
    // the notifications from about:social as it starts
    if (aTopic == 'document-element-inserted' && aDocument &&
        (aDocument.location == ABOUTURL || aDocument.location == "about:social")) {
      // setup messaging for our about prefs page
      this.hookupPrefs(aDocument);
      aDocument.defaultView.addEventListener("message",
                                             this.onPrefsMessage.bind(this),
                                             true);
      // when the document load completes we setup the enabled-disabled state.
      // (doing it too early means the UI state defined in the HTML wins the race)
      let loadHandler = function() {
        aDocument.removeEventListener("DOMContentLoaded", loadHandler, false);
        let enabled = Cc["@mozilla.org/socialProviderRegistry;1"]
               .getService(Ci.mozISocialRegistry).enabled;
        let subtopic = "social-browsing-" + (enabled ? "enabled" : "disabled");
        this.observe(null, subtopic, null);
      }.bind(this);
      aDocument.addEventListener("DOMContentLoaded", loadHandler, false);
      return;
    }
    if (aTopic == 'social-browsing-disabled' || aTopic == 'social-browsing-enabled') {
      this.postToAll({topic: aTopic});
      return;
    }
    if (aTopic == 'social-service-manifest-changed') {
      ManifestDB.get(aData, function( manifest) {
        this.postToAll({topic: aTopic, data: manifest});
      }.bind(this));
    }
  },

  postToAll: function(data) {
    // enumerate all about:social windows and post 'em the data.
    var enumerator = Services.wm.getEnumerator("navigator:browser");
    while(enumerator.hasMoreElements()) {
      var win = enumerator.getNext();
      for (let i=0; i < win.gBrowser.browsers.length; i++) {
        let tabWindow = win.gBrowser.getBrowserAtIndex(i).contentWindow;
        if (tabWindow.location == ABOUTURL || tabWindow.location == "about:social") {
          tabWindow.postMessage(JSON.stringify(data), "*");
        }
      }
    }
  },

  hookupPrefs: function(aDocument) {
    ManifestDB.iterate(function(key, manifest) {
      try {
        var win = aDocument.defaultView;
        let data = JSON.stringify({
          topic: "social-service-manifest-changed",
          data: manifest
        });
        win.postMessage(data, "*");
      }
      catch(e) {
        Cu.reportError(e);
      }
    });
  },
  
  onPrefsMessage: function(event) {
    // XXX - WARNING - this also receives messages *we* post!  Otherwise we
    // could just reuse the topic names and keep things sane.  But this means
    // we need one topic for setting a value, and another for observing a
    // change from the html.
    let msg = JSON.parse(event.data);

    if (msg.topic === "preference-service-change") {
      let registry = Cc["@mozilla.org/socialProviderRegistry;1"]
                   .getService(Ci.mozISocialRegistry);
      let data = msg.data;
      if (data.enabled) {
        registry.enableProvider(data.origin);
      } else {
        registry.disableProvider(data.origin);
      }
      return;
    }
    if (msg.topic === "preference-social-change") {
      let registry = Cc["@mozilla.org/socialProviderRegistry;1"]
                   .getService(Ci.mozISocialRegistry);
      registry.enabled = msg.data.enabled;
      return;
    }
  }
}

// global init
Services.obs.addObserver(aboutPage, 'document-element-inserted', false);
Services.obs.addObserver(aboutPage, 'social-browsing-enabled', false);
Services.obs.addObserver(aboutPage, 'social-browsing-disabled', false);
Services.obs.addObserver(aboutPage, 'social-service-manifest-changed', false);


const components = [AboutSocial];
const NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
