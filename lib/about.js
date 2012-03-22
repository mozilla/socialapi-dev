const {classes: Cc, interfaces: Ci, utils: Cu, manager: Cm} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

Cu.import("resource://socialdev/lib/unload+.js");
Cu.import("resource://socialdev/lib/manifestDB.jsm");

const ABOUTURL = "resource://socialdev/data/about.html";
const EXPORTED_SYMBOLS = [];

//----- about:passwords implementation
const AboutSocialUUID = Components.ID("{ddf3f2e0-c819-b843-b32c-c8834d98ef49}");
const AboutSocialContract = "@mozilla.org/network/protocol/about;1?what=social";
let AboutSocialFactory = {
  createInstance: function(outer, iid) {
    if (outer != null) throw Cr.NS_ERROR_NO_AGGREGATION;
    return AboutSocial.QueryInterface(iid);
  }
};
let AboutSocial = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIAboutModule]),

  getURIFlags: function(aURI) {
    return Ci.nsIAboutModule.ALLOW_SCRIPT;
  },

  newChannel: function(aURI) {
    let ios = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
    let channel = ios.newChannel(ABOUTURL, null, null);
    channel.originalURI = aURI;
    return channel;
  }
};
//----- end about:social (but see ComponentRegistrar call in startup())


var aboutPage = {
  observe: function(aDocument, aTopic, aData) {
    if (aTopic != 'document-element-inserted' || !aDocument ||
        (aDocument.location != ABOUTURL && aDocument.location != "about:social")) {
      //dump("not for us!" + aDocument.location+ "\n");
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
        //dump("postMessage to " + win.location + " = "+JSON.stringify(manifest)+"\n");
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
Cm.QueryInterface(Ci.nsIComponentRegistrar).registerFactory(
  AboutSocialUUID, "About Social", AboutSocialContract, AboutSocialFactory
);

unload(function() {
  Cm.QueryInterface(Ci.nsIComponentRegistrar).unregisterFactory(
    AboutSocialUUID, AboutSocialFactory
  );
});


