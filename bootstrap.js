/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This bootstrap file uses chrome.manifest to dynamically register
 * chrome/skin/locale URIs, allowing an overlay based addon to easily
 * become restartless.  It is based on work by Dave Townsend at
 * https://github.com/Mossop/WebAppTabs/
 *
 * One limitation is that addons cannot use custom XPCOM interfaces (ie. if you
 * have an IDL file, this wont work). XPCOM registration beyond basic stuff
 * has not been tested.
 */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Ce = Components.Exception;
const Cr = Components.results;
const Cu = Components.utils;
const Cm = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);

const XMLURI_PARSE_ERROR = "http://www.mozilla.org/newlayout/xml/parsererror.xml"

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/ChromeManifestParser.jsm");

/**
 * loadSandbox
 *
 * loads a set of scripts into a sandbox.  All scripts in an overlay
 * are loaded into a single sandbox
 */
function loadSandbox(aPrincipal, aDocumentURL, aScripts, aPrototype) {
  let args = {
    sandboxName: aDocumentURL
  };

  if (aPrototype) {
    args.sandboxPrototype = aPrototype;
  }

  let sandbox = Cu.Sandbox(aPrincipal, args);

  for each(let aScriptURL in aScripts) {
    try {
      Services.scriptloader.loadSubScript(aScriptURL, sandbox);
    } catch (e) {
      Cu.reportError("Exception loading script " + aScriptURL + ": "+ e);
    }
  }
  return sandbox
}


const OverlayManager = {
  windowEntryMap: new WeakMap(),
  windowEntries: {},
  overlays: {},
  components: [],
  categories: [],
  contracts: [],
  preferences: [],
  manifest: [],
  resourceURI: null,
  resourceName: null,

  init: function(aParams, preload) {
    Services.console.logStringMessage("init");

    let manifestURI = Services.io.newURI(aParams.resourceURI.resolve("./chrome.manifest"), null, null);

    this.manifest = ChromeManifestParser.parseSync(manifestURI);

    // browse through our chrome.manifest and load up anything we may need
    let components = {};
    let resourceName;
    let resourcePath = "./";
    for each(let entry in this.manifest) {
      if (entry.type == "content") {
        if (!this.resourceName) this.resourceName = entry.args[0];
      } else if (entry.type == "resource") {
        this.resourceName = entry.args[0];
        resourcePath = entry.args[1];
      } else if (entry.type == "component") {
        components[entry.args[0]] = {
          url: entry.args[1],
          contract: null
        }
      } else if (entry.type == "contract") {
        components[entry.args[1]].contract = entry.args[0]
      } else if (entry.type == "overlay") {
        let windowURL = entry.args[0];
        let overlayData = {
          overlay: entry.args[1]
        }
        // support some options
        for each(let a in entry.args) {
          let m = a.match(/(\w+)=(.*)/);
          if (m && m[1]) {
            overlayData[m[1]] = m[2];
          }
        }
        if (!(windowURL in this.overlays)) {
          this.overlays[windowURL] = [overlayData];
        } else {
          this.overlays[windowURL].push(overlayData);
        }
      }
    }

    if (!this.resourceName) {
      throw new Ce("no content or resource entry in manifest");
    }

    let res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    let resURI = Services.io.newURI(aParams.resourceURI.resolve(resourcePath), null, null);
    res.setSubstitution(this.resourceName, resURI);
    this.resourceURI = Services.io.newURI("resource://"+this.resourceName+"/", null, null);

    // properly register chrome/skin/locale URIs
    Cm.addBootstrappedManifestLocation(aParams.installPath);

    // register our components
    for (let [cid, component] in Iterator(components)) {
      OverlayManager.addComponent(cid,
                                  this.resourceURI.resolve(component.url),
                                  component.contract);
    }

    Services.wm.addListener(this);

    // load any addon specific stuff not handled via manifest
    preload();

    // load our overlays
    OverlayManager.addOverlays(this.overlays);
  },

  unload: function(aParams) {
    Services.console.logStringMessage("unload");
    try {
      // Close any of our UI windows
      let windows = Services.wm.getEnumerator(null);
      while (windows.hasMoreElements()) {
        let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
        let spec = domWindow.location.toString();
        if (spec.indexOf(this.resourceURI.spec) == 0) {
          domWindow.close();
        }
      }
      Services.wm.removeListener(this);

      for (let windowURL in this.windowEntries) {
        for each(let windowEntry in this.windowEntries[windowURL]) {
          this.destroyWindowEntry(windowEntry);
        }
      }
      this.windowEntries = {};

      let cm = Cc["@mozilla.org/categorymanager;1"].
               getService(Ci.nsICategoryManager);
      this.categories.forEach(function([aCategory, aEntry, aOldValue]) {
        if (aOldValue) {
          cm.addCategoryEntry(aCategory, aEntry, aOldValue, false, true);
        } else {
          cm.deleteCategoryEntry(aCategory, aEntry, false);
        }
      });

      this.components.forEach(function(aCid) {
        let factory = Cm.getClassObject(aCid, Ci.nsIFactory);
        Cm.unregisterFactory(aCid, factory);
      });

      this.contracts.forEach(function([aContract, aCid]) {
        Cm.registerFactory(aCid, null, aContract, null);
      });

      this.preferences.forEach(function([aName, aType, aValue]) {
        if (aValue === null) {
          Services.prefs.clearUserPref(aName);
        } else {
          Services.prefs["set" + aType](aName, aValue);
        }
      });

      // Remove our chrome registration
      Cm.removeBootstrappedManifestLocation(aParams.installPath)

      // Clear our resource registration
      let res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
      res.setSubstitution(this.resourceName, null);

      try {
        if (!Services.prefs.getBoolPref("extensions."+this.resourceName+".debug")) {
          return;
        }

        // For testing invalidate the startup cache
        Services.obs.notifyObservers(null, "startupcache-invalidate", null);
      } catch (e) {
      }

    } catch (e) {
      Cu.reportError("Exception during unload: "+ e);
    }
  },

  createWindowEntry: function(aDOMWindow, aOverlays) {
    aDOMWindow.addEventListener("unload", this, false);

    let windowURL = aDOMWindow.location.toString();
    Services.console.logStringMessage("Creating window entry for " + windowURL);
    if (this.windowEntryMap.has(aDOMWindow)) {
      throw new Ce("Already registered window entry for " + windowURL);
    }

    if (!(windowURL in this.windowEntries)) {
      this.windowEntries[windowURL] = [];
    }

    let newEntry = {
      window: aDOMWindow,
      url: windowURL,
      sandbox: null,
      nodes: [],
    };

    this.windowEntries[windowURL].push(newEntry);
    this.windowEntryMap.set(aDOMWindow, newEntry);

    this.applyWindowEntryOverlays(newEntry, aOverlays);
    return newEntry
  },

  destroyWindowEntry: function(aWindowEntry) {
    try {
    aWindowEntry.window.removeEventListener("unload", this, false);
    this.windowEntryMap.delete(aWindowEntry.window);

    try {
      if ("OverlayListener" in aWindowEntry.sandbox && "unload" in aWindowEntry.sandbox.OverlayListener) {
        aWindowEntry.sandbox.OverlayListener.unload();
      }
    } catch (e) {
      Cu.reportError("Exception calling script unload listener: "+ e);
    }
    delete aWindowEntry.sandbox;

    aWindowEntry.nodes.forEach(function(aNode) {
      aNode.parentNode.removeChild(aNode);
    }, this);
    aWindowEntry.nodes = [];

    Services.console.logStringMessage("Destroyed window entry for " + aWindowEntry.url);
    } catch(e) {
      Cu.reportError(e);
    }
  },

  applyWindowEntryOverlays: function(aWindowEntry, aOverlays) {
    for each(let aDocData in aOverlays) {
      this.loadDocumentOverlay(aWindowEntry, aDocData);
    }
  },

  loadDocumentOverlay: function(aWindowEntry, aDocData) {
    let xulRuntime = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime);
    if (aDocData.os && aDocData.os != xulRuntime.OS) {
      return;
    }
    Services.console.logStringMessage("Loading document overlay " + aDocData.overlay);

    // TODO make this async
    let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
              createInstance(Ci.nsIXMLHttpRequest);
    xhr.open("GET", aDocData.overlay, false);
    xhr.send();

    let overlayDoc = xhr.responseXML;
    if (overlayDoc.documentElement.namespaceURI == XMLURI_PARSE_ERROR) {
      Cu.reportError("Document Parse Error " + aDocData.overlay);
      return;
    }

    let targetDoc = aWindowEntry.window.document;

    // load any stylesheets the overlay is defining into the xul document
    let elem = overlayDoc.firstChild;
    while (elem) {
      if (elem.nodeName == "xml-stylesheet") {
        // href="chrome://socialdev/skin/browser.css" type="text/css"
        let t = elem.nodeValue.match(/\s+type=\"(.*)\"/);
        if (t[1] != "text/css") {
          continue;
        }
        let m = elem.nodeValue.match(/href=\"(.*)\"/);
        if (m[1]) {
          this.loadStyleOverlay(aWindowEntry, m[1]);
        }
      }
      elem = elem.nextSibling;
    }

    function walkDocumentNodes(aDocument) {
      let node = aDocument.documentElement;

      while (node) {
        let currentNode = node;

        // If possible to descend then do so
        if (node.firstChild) {
          node = node.firstChild;
        } else {
          // Otherwise find the next node in the document by walking up the tree
          // until there is a nextSibling (or we hit the documentElement)
          while (!node.nextSibling && node.parentNode != overlayDoc.documentElement) {
            node = node.parentNode;
          }

          // Select the nextSibling (or null if we hit the top)
          node = node.nextSibling;
        }

        yield currentNode;
      }
    }

    function elementChildren(aElement) {
      let node = aElement.firstChild;
      while (node) {
        let currentNode = node;

        node = node.nextSibling;

        if (currentNode instanceof Ci.nsIDOMElement) {
          yield currentNode;
        }
      }
    }

    for (let node in walkDocumentNodes(overlayDoc)) {
      // Remove the node if it is an empty text node
      if (node.nodeType == Ci.nsIDOMNode.TEXT_NODE && node.nodeValue.trim() == "") {
        node.parentNode.removeChild(node);
      }
    }

    // track any scripts we find
    let scripts = [];
    for (let containerElement in elementChildren(overlayDoc.documentElement)) {
      let targetElement;
      if (!containerElement.id) {
        if (containerElement.localName == "script") {
          scripts.push(containerElement.getAttribute("src"));
          continue;
        } else {
          let elements = targetDoc.getElementsByTagName(containerElement.localName);
          targetElement = elements[0];
        }
      } else {
        targetElement = targetDoc.getElementById(containerElement.id);
      }

      if (!targetElement || (containerElement.localName != "script" && targetElement.localName != containerElement.localName)) {
        Cu.reportError("Unable to find overlay element "+containerElement.localName+" into "+targetElement);
        continue;
      }

      // TODO apply attributes to the target element

      for (let newElement in elementChildren(containerElement)) {
        let insertBefore = null;

        if (newElement.hasAttribute("insertbefore")) {
          insertBefore = targetDoc.getElementById(newElement.getAttribute("insertbefore"));
          if (insertBefore && insertBefore.parentNode != targetElement) {
            insertBefore = null;
          }
        }

        if (!insertBefore && newElement.hasAttribute("insertafter")) {
          insertBefore = targetDoc.getElementById(newElement.getAttribute("insertafter"));
          if (insertBefore) {
            if (insertBefore.parentNode != targetElement) {
              insertBefore = null
            } else {
              insertBefore = insertBefore.nextSibling;
            }
          }
        }

        targetElement.insertBefore(newElement, insertBefore);
        aWindowEntry.nodes.push(newElement);
      }
    }

    // for a given overlay, load all the scripts into a single sandbox.
    // anything in the xul elements (commands, etc.) need to have some kind
    // of access into the sandbox, so the sandboxed scripts must set something
    // explicitly onto the window object.
    aWindowEntry.sandbox = loadSandbox(aWindowEntry.window, aDocData.overlay, scripts, aWindowEntry.window);

    if ("OverlayListener" in aWindowEntry.sandbox && "load" in aWindowEntry.sandbox.OverlayListener) {
      try {
        aWindowEntry.sandbox.OverlayListener.load();
      } catch (e) {
        Cu.reportError("Exception calling overlay script load event: "+ e);
      }
    }
  },

  loadStyleOverlay: function(aWindowEntry, aStyleURL) {
    Services.console.logStringMessage("Loading style overlay " + aStyleURL);

    let doc = aWindowEntry.window.document;
    let styleNode = doc.createProcessingInstruction("xml-stylesheet",
                                                    "href=\"" + aStyleURL + "\" " +
                                                    "type=\"text/css\"");
    doc.insertBefore(styleNode, doc.documentElement);

    aWindowEntry.nodes.push(styleNode);
  },

  addOverlays: function(aOverlayList) {
    try {
      // First check over the new overlays, merge them into the master list
      // and if any are for already tracked windows apply them
      for (let [windowURL, overlayData] in Iterator(aOverlayList)) {

        if (!(windowURL in this.overlays)) {
          this.overlays[windowURL] = overlayData;
        } else {
          this.overlays[windowURL].concat(overlayData);
        }

        // Apply the new overlays to any already tracked windows
        if (windowURL in this.windowEntries) {
          this.windowEntries[windowURL].forEach(function(aWindowEntry) {
            this.applyWindowEntryOverlays(aWindowEntry, overlayData);
          }, this);
        }
      }

      // Search over existing windows to see if any need to be tracked now
      let windows = Services.wm.getEnumerator(null);
      while (windows.hasMoreElements()) {
        let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
        let windowURL = domWindow.location.toString();

        // If we are adding overlays for this window and not already tracking
        // this window then start to track it and add the new overlays
        if ((windowURL in aOverlayList) && !this.windowEntryMap.has(domWindow)) {
          this.createWindowEntry(domWindow, aOverlayList[windowURL]);
        }
      }
    } catch (e) {
      Cu.reportError("Exception adding overlay list: "+ e);
      dump(e.stack+"\n");
    }
  },

  addComponent: function(aCid, aComponentURL, aContract) {
    if (aContract) {
      try {
        let cid = Cm.contractIDToCID(aContract);
        // It's possible to have a contract to CID mapping when the CID doesn't
        // exist
        if (Cm.isCIDRegistered(cid)) {
          this.contracts.push([aContract, cid]);
        }
      } catch (e) {
      }
    }

    aCid = Components.ID(aCid);
    Cm.registerFactory(aCid, null, aContract, {
      _sandbox: null,

      createInstance: function(aOuter, aIID) {
        if (!this._sandbox) {
          let principal = Cc["@mozilla.org/systemprincipal;1"].
                          createInstance(Ci.nsIPrincipal);
          this._sandbox = loadSandbox(principal, aComponentURL, [aComponentURL]);
        }

        if (!("NSGetFactory" in this._sandbox)) {
          Cu.reportError("Component " + aComponentURL + " is missing NSGetFactory");
          throw Cr.NS_ERROR_FACTORY_NOT_REGISTERED;
        }

        try {
          return this._sandbox.NSGetFactory(aCid).createInstance(aOuter, aIID);
        } catch (e) {
          Cu.reportError("Exception initialising component " + aContract + " from " + aComponentURL + ": "+ e);
          throw e;
        }
      }
    });

    this.components.push(aCid);
  },

  addCategory: function(aCategory, aEntry, aValue) {
    let cm = Cc["@mozilla.org/categorymanager;1"].
             getService(Ci.nsICategoryManager);
    let oldValue = null;
    try {
      oldValue = cm.getCategoryEntry(aCategory, aEntry);
    } catch (e) {
    }
    cm.addCategoryEntry(aCategory, aEntry, aValue, false, true);
    this.categories.push([aCategory, aEntry, oldValue]);
  },

  // nsIEventListener implementation
  handleEvent: function(aEvent) {
    try {
      let domWindow = aEvent.currentTarget;

      switch (aEvent.type) {
        case "DOMContentLoaded":
          domWindow.removeEventListener("DOMContentLoaded", this, false);
          let windowURL = domWindow.location.toString();
          // Track this window if there are overlays for it
          if (windowURL in this.overlays) {
            let overlays = this.overlays[windowURL];
            OverlayManager.createWindowEntry(domWindow, overlays);
          }
          break;
        case "unload":
          if (!this.windowEntryMap.has(domWindow)) {
            Cu.reportError("Saw unload event for unknown window " + domWindow.location);
            return;
          }
          let windowEntry = this.windowEntryMap.get(domWindow);
          OverlayManager.destroyWindowEntry(windowEntry);
          break;
      }
    } catch (e) {
      Cu.reportError("Error during window " + aEvent.type +": "+ e);
    }
  },

  // nsIWindowMediatorListener implementation
  onOpenWindow: function(aXULWindow) {
    let domWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                              .getInterface(Ci.nsIDOMWindow);

    // We can't get the window's URL until it is loaded
    domWindow.addEventListener("DOMContentLoaded", this, false);
  },

  onWindowTitleChange: function() { },
  onCloseWindow: function() { },
};

// bootstrap functions

function install(aParams, aReason) {
}

function startup(aParams, aReason) {
  OverlayManager.init(aParams, function() {
    // addon specific stuff we need to start before
    // applying our overlays
    Cu.import("resource://socialdev/modules/registry.js");
  });
}

function shutdown(aParams, aReason) {
  // We need to shutdown the typedstorage database else we assert in
  // debug builds at shutdown.
  let tmp = {};
  Cu.import("resource://socialdev/modules/manifestDB.jsm", tmp);
  tmp.ManifestDB.close();

  // Don't need to clean anything else up if the application is shutting down
  if (aReason == APP_SHUTDOWN) {
    return;
  }
  // Unload and remove the overlay manager
  OverlayManager.unload(aParams);
}

function uninstall(aParams, aReason) {
}
