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
    if (aTopic != 'document-element-inserted' || !aDocument ||
        (aDocument.location != ABOUTURL && aDocument.location != "about:social")) {
      return;
    }
    // setup messaging for our about prefs page
    this.hookupPrefs(aDocument);
    aDocument.defaultView.addEventListener("message",
                                          this.onPrefsMessage.bind(this),
                                          true);
  },

  hookupPrefs: function(aDocument) {
    ManifestDB.iterate(function(key, manifest) {
      try {
        var win = aDocument.defaultView;
        let data = JSON.stringify({
          topic: "service-manifest",
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
    let msg = JSON.parse(event.data);
    if (msg.topic !== "preference-change")
      return;
    // send a notification, the providerRegistry watches for this
    let data = msg.data;
    if (data.enabled)
      Services.obs.notifyObservers(null, "social-service-enabled", data.origin);
    else
      Services.obs.notifyObservers(null, "social-service-disabled", data.origin);
  }
}

// global init
Services.obs.addObserver(aboutPage, 'document-element-inserted', false);


const components = [AboutSocial];
const NSGetFactory = XPCOMUtils.generateNSGetFactory(components);

