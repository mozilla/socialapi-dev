

const {classes: Cc, interfaces: Ci, utils: Cu, manager: Cm} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialapi/modules/manifestDB.jsm");
Cu.import("resource://socialapi/modules/manifest.jsm");

/**
 * getDefaultProviders
 *
 * look into our addon/feature dir and see if we have any builtin providers to install
 */
function getBuiltinProviders() {
  var URIs = [];
  try {
    // figure out our installPath
    let res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    let installURI = Services.io.newURI("resource://socialapi/", null, null);
    let installPath = res.resolveURI(installURI);
    let installFile = Services.io.newURI(installPath, null, null);
    try {
      installFile = installFile.QueryInterface(Components.interfaces.nsIJARURI);
    } catch (ex) {} //not a jar file

    // load all prefs in defaults/preferences into a sandbox that has
    // a pref function
    let resURI = Services.io.newURI("resource://socialapi/providers", null, null);
    // If we're a XPI, load from the jar file
    if (installFile.JARFile) {
      let fileHandler = Components.classes["@mozilla.org/network/protocol;1?name=file"].
                  getService(Components.interfaces.nsIFileProtocolHandler);
      let fileName = fileHandler.getFileFromURLSpec(installFile.JARFile.spec);
      let zipReader = Cc["@mozilla.org/libjar/zip-reader;1"].
                      createInstance(Ci.nsIZipReader);
      try {
        zipReader.open(fileName);
        let entries = zipReader.findEntries("providers/*");
        while (entries.hasMore()) {
          var entryName = resURI.resolve(entries.getNext());
          if (entryName.indexOf("app.manifest") >= 0)
            URIs.push(entryName);
        }
      }
      finally {
        zipReader.close();
      }
    }
    else {
      let fURI = resURI.QueryInterface(Components.interfaces.nsIFileURL).file;

      var entries = fURI.directoryEntries;
      while (entries.hasMoreElements()) {
        var entry = entries.getNext();
        entry.QueryInterface(Components.interfaces.nsIFile);
        if (entry.leafName.length > 0 && entry.leafName[0] != '.') {
          URIs.push(resURI.resolve("providers/"+entry.leafName+"/app.manifest"));
        }
      }
    }
    //dump(JSON.stringify(URIs)+"\n");
  } catch(e) {
    Cu.reportError(e);
  }
  return URIs
}

function installBuiltinProviders() {
  // load the builtin providers if any
  let URIs = getBuiltinProviders();
  for each(let uri in URIs) {
    manifestSvc.loadManifest(null, uri, true);
  }
}
installBuiltinProviders();

var DocumentObserver = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIObserver]),
  init: function() {
    Services.obs.addObserver(DocumentObserver, "document-element-inserted", true);
  },
  discoverManifest: function DocumentObserver_discoverManifest(aDocument, aData) {
    // BUG 732266 this is probably heavy weight, is there a better way to watch for
    // links in documents?
    // https://developer.mozilla.org/En/Listening_to_events_in_Firefox_extensions
    // DOMLinkAdded event
    let _prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);;

    // TODO determine whether or not we actually want to load this
    // manifest.
    // 1. is it already loaded, skip it, we'll check it for updates another
    //    way
    // 2. does the user have a login for the site, if so, load it
    // 3. does the fecency for the site warrent loading the manifest and
    //    offering to the user?
    try {
      if (_prefBranch.getBoolPref(aDocument.defaultView.location.host+".ignore")) {
        return;
      }
    } catch(e) {}

    // we need a way to test against local non-http servers on occasion
    let allow_http = false;
    try {
      allow_http = _prefBranch.getBoolPref("devmode");
    } catch(e) {}

    let links = aDocument.getElementsByTagName('link');
    for (let index=0; index < links.length; index++) {
      let link = links[index];
      if (link.getAttribute('rel') == 'manifest' &&
          link.getAttribute('type') == 'text/json') {
        //Services.console.logStringMessage("found manifest url "+link.getAttribute('href'));
        let baseUrl = aDocument.defaultView.location.href;
        let url = Services.io.newURI(baseUrl, null, null).resolve(link.getAttribute('href'));
        let resolved = Services.io.newURI(url, null, null);
        // we only allow remote manifest files loaded from https
        if (!allow_http && resolved.scheme != "https")
          return;
        //Services.console.logStringMessage("base "+baseUrl+" resolved to "+url);
        ManifestDB.get(url, function(key, item) {
          if (!item) {
            manifestSvc.loadManifest(aDocument, url);
          }
        });
      }
    }
  },

  /**
   * observer
   *
   * reset our mediators if an app is installed or uninstalled
   */
  observe: function DocumentObserver_observe(aSubject, aTopic, aData) {
    if (aTopic == "document-element-inserted") {
      if (!aSubject.defaultView)
        return;
      //Services.console.logStringMessage("new document "+aSubject.defaultView.location);
      DocumentObserver.discoverManifest(aSubject, aData);
      return;
    }
  }
}

DocumentObserver.init();

const EXPORTED_SYMBOLS = ["DocumentObserver"];
