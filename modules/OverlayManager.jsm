/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const EXPORTED_SYMBOLS = ["OverlayManager"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Ce = Components.Exception;
const Cr = Components.results;
const Cu = Components.utils;
const Cm = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);

const XMLURI_PARSE_ERROR = "http://www.mozilla.org/newlayout/xml/parsererror.xml"

Cu.import("resource://gre/modules/Services.jsm");

function createSandbox(aPrincipal, aScriptURL, aPrototype) {
  let args = {
    sandboxName: aScriptURL
  };

  if (aPrototype)
    args.sandboxPrototype = aPrototype;

  let sandbox = Cu.Sandbox(aPrincipal, args);

  try {
    Services.scriptloader.loadSubScript(aScriptURL, sandbox);
  }
  catch (e) {
    Cu.reportError("Exception loading script " + aScriptURL + ": "+ e);
  }

  return sandbox
}

function loadSandbox(aPrincipal, aDocumentURL, aScripts, aPrototype) {
  let args = {
    sandboxName: aDocumentURL
  };

  if (aPrototype)
    args.sandboxPrototype = aPrototype;

  let sandbox = Cu.Sandbox(aPrincipal, args);

  try {
    for each(let aScriptURL in aScripts) {
      Services.scriptloader.loadSubScript(aScriptURL, sandbox);
    }
  }
  catch (e) {
    Cu.reportError("Exception loading script " + aScriptURL + ": "+ e);
  }

  return sandbox 
}

const OverlayManager = {
  addOverlays: function(aOverlayList) {
    OverlayManagerInternal.addOverlays(aOverlayList);
  },

  addComponent: function(aCid, aComponentURL, aContract) {
    OverlayManagerInternal.addComponent(aCid, aComponentURL, aContract);
  },

  addCategory: function(aCategory, aEntry, aValue) {
    OverlayManagerInternal.addCategory(aCategory, aEntry, aValue);
  },

  addPreference: function(aName, aValue) {
    OverlayManagerInternal.addPreference(aName, aValue);
  },

  getScriptContext: function(aWindow, aScriptURL) {
    return OverlayManagerInternal.getScriptContext(aWindow, aScriptURL);
  },

  unload: function() {
    OverlayManagerInternal.unload();
  }
};

const OverlayManagerInternal = {
  windowEntryMap: new WeakMap(),
  windowEntries: {},
  overlays: {},
  components: [],
  categories: [],
  contracts: [],
  preferences: [],

  init: function() {
    Services.console.logStringMessage("init");
    Services.wm.addListener(this);
  },

  unload: function() {
    Services.console.logStringMessage("unload");
    try {
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
        if (aOldValue)
          cm.addCategoryEntry(aCategory, aEntry, aOldValue, false, true);
        else
          cm.deleteCategoryEntry(aCategory, aEntry, false);
      });

      this.components.forEach(function(aCid) {
        let factory = Cm.getClassObject(aCid, Ci.nsIFactory);
        Cm.unregisterFactory(aCid, factory);
      });

      this.contracts.forEach(function([aContract, aCid]) {
        Cm.registerFactory(aCid, null, aContract, null);
      });

      this.preferences.forEach(function([aName, aType, aValue]) {
        if (aValue === null)
          Services.prefs.clearUserPref(aName);
        else
          Services.prefs["set" + aType](aName, aValue);
      });
    }
    catch (e) {
      Cu.reportCu.reportError("Exception during unload: "+ e);
    }
  },

  createWindowEntry: function(aDOMWindow, aOverlays) {
    aDOMWindow.addEventListener("unload", this, false);

    let windowURL = aDOMWindow.location.toString();
    Services.console.logStringMessage("Creating window entry for " + windowURL);
    if (this.windowEntryMap.has(aDOMWindow))
      throw new Ce("Already registered window entry for " + windowURL);

    if (!(windowURL in this.windowEntries))
      this.windowEntries[windowURL] = [];

    let newEntry = {
      window: aDOMWindow,
      scripts: {},
      overlayScripts: [],
      nodes: [],
    };

    this.windowEntries[windowURL].push(newEntry);
    this.windowEntryMap.set(aDOMWindow, newEntry);

    this.applyWindowEntryOverlays(newEntry, aOverlays);
    return newEntry
  },

  destroyWindowEntry: function(aWindowEntry) {
    aWindowEntry.window.removeEventListener("unload", this, false);

    let windowURL = aWindowEntry.window.location.toString();
    Services.console.logStringMessage("Destroying window entry for " + windowURL);

    this.windowEntryMap.delete(aWindowEntry.window);

    for (let [,sandbox] in Iterator(aWindowEntry.scripts)) {
      try {
        if ("OverlayListener" in sandbox && "unload" in sandbox.OverlayListener)
          sandbox.OverlayListener.unload();
      }
      catch (e) {
        Cu.reportError("Exception calling script unload listener: "+ e);
      }
    }
    aWindowEntry.scripts = {};
    for each(let sandbox in aWindowEntry.overlayScripts) {
      try {
        if ("OverlayListener" in sandbox && "unload" in sandbox.OverlayListener)
          sandbox.OverlayListener.unload();
      }
      catch (e) {
        Cu.reportError("Exception calling script unload listener: "+ e);
      }
    }
    aWindowEntry.overlayScripts = [];

    aWindowEntry.nodes.forEach(function(aNode) {
      aNode.parentNode.removeChild(aNode);
    }, this);
    aWindowEntry.nodes = [];
  },

  applyWindowEntryOverlays: function(aWindowEntry, aOverlays) {
    if ("styles" in aOverlays) {
      aOverlays.styles.forEach(function(aStyleURL) {
        this.loadStyleOverlay(aWindowEntry, aStyleURL);
      }, this);
    }

    if ("documents" in aOverlays) {
      aOverlays.documents.forEach(function(aDocData) {
        this.loadDocumentOverlay(aWindowEntry, aDocData);
      }, this);
    }

    if ("scripts" in aOverlays) {
      aOverlays.scripts.forEach(function(aScriptURL) {
        this.loadScriptOverlay(aWindowEntry, aScriptURL);
      }, this);
    }
  },

  loadDocumentOverlay: function(aWindowEntry, aDocData) {
    let xulRuntime = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime);
    if (aDocData.OS && aDocData.OS != xulRuntime.OS)
      return;
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
        let m = elem.nodeValue.match(/href=\"(.*)\"\s+type=\"(.*)\"/);
        if (m[2] == "text/css") {
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
        }
        else {
          // Otherwise find the next node in the document by walking up the tree
          // until there is a nextSibling (or we hit the documentElement)
          while (!node.nextSibling && node.parentNode != overlayDoc.documentElement)
            node = node.parentNode;

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

        if (currentNode instanceof Ci.nsIDOMElement)
          yield currentNode;
      }
    }

    for (let node in walkDocumentNodes(overlayDoc)) {
      // Remove the node if it is an empty text node
      if (node.nodeType == Ci.nsIDOMNode.TEXT_NODE && node.nodeValue.trim() == "")
        node.parentNode.removeChild(node);
    }

    // track any scripts we find
    let scripts = [];
    for (let containerElement in elementChildren(overlayDoc.documentElement)) {
      let targetElement;
      if (!containerElement.id) {
        if (containerElement.localName == "script") {
          scripts.push(containerElement.getAttribute("src"));
          continue;
        }
        else {
          let elements = targetDoc.getElementsByTagName(containerElement.localName);
          targetElement = elements[0];
        }
      }
      else {
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
          if (insertBefore && insertBefore.parentNode != targetElement)
            insertBefore = null;
        }

        if (!insertBefore && newElement.hasAttribute("insertafter")) {
          insertBefore = targetDoc.getElementById(newElement.getAttribute("insertafter"));
          if (insertBefore) {
            if (insertBefore.parentNode != targetElement)
              insertBefore = null
            else
              insertBefore = insertBefore.nextSibling;
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
    let sandbox = loadSandbox(aWindowEntry.window, aDocData.overlay, scripts, aWindowEntry.window);
    aWindowEntry.overlayScripts.push(sandbox);
    
    if ("OverlayListener" in sandbox && "load" in sandbox.OverlayListener) {
      try {
        sandbox.OverlayListener.load();
      }
      catch (e) {
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

  loadScriptOverlay: function(aWindowEntry, aScriptURL) {
    Services.console.logStringMessage("Loading script overlay " + aScriptURL);

    let sandbox = createSandbox(aWindowEntry.window, aScriptURL, aWindowEntry.window);
    aWindowEntry.scripts[aScriptURL] = sandbox;

    if ("OverlayListener" in sandbox && "load" in sandbox.OverlayListener) {
      try {
        sandbox.OverlayListener.load();
      }
      catch (e) {
        Cu.reportError("Exception calling script load event " + aScriptURL +": "+ e);
      }
    }
  },

  addOverlays: function(aOverlayList) {
    try {
      // First check over the new overlays, merge them into the master list
      // and if any are for already tracked windows apply them
      for (let [windowURL, overlayData] in Iterator(aOverlayList)) {

        if (!(windowURL in this.overlays))
          this.overlays[windowURL] = {};
        let existingOverlays = this.overlays[windowURL];

        ["documents", "styles", "scripts"].forEach(function(aType) {
          if (!(overlayData[aType]))
            return;

          if (!(aType in existingOverlays))
            existingOverlays[aType] = overlayData[aType].slice(0);
          else
            existingOverlays[aType].push(overlayData[aType]);
        }, this);

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
          let windowEntry = this.createWindowEntry(domWindow, aOverlayList[windowURL]);
        }
      }
    }
    catch (e) {
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
        if (Cm.isCIDRegistered(cid))
          this.contracts.push([aContract, cid]);
      }
      catch (e) {
      }
    }

    aCid = Components.ID(aCid);
    Cm.registerFactory(aCid, null, aContract, {
      _sandbox: null,

      createInstance: function(aOuter, aIID) {
        if (!this._sandbox) {
          let principal = Cc["@mozilla.org/systemprincipal;1"].
                          createInstance(Ci.nsIPrincipal);
          this._sandbox = createSandbox(principal, aComponentURL);
        }

        if (!("NSGetFactory" in this._sandbox)) {
          Cu.reportError("Component " + aComponentURL + " is missing NSGetFactory");
          throw Cr.NS_ERROR_FACTORY_NOT_REGISTERED;
        }

        try {
          return this._sandbox.NSGetFactory(aCid).createInstance(aOuter, aIID);
        }
        catch (e) {
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
    }
    catch (e) { }
    cm.addCategoryEntry(aCategory, aEntry, aValue, false, true);
    this.categories.push([aCategory, aEntry, oldValue]);
  },

  addPreference: function(aName, aValue) {
    let oldValue = null;

    let type = "CharPref";
    switch (typeof aValue) {
    case "number":
      type = "IntPref";
      break;
    case "boolean":
      type = "BoolPref";
      break;
    }

    if (Services.prefs.getPrefType(aName) != Ci.nsIPrefBranch.PREF_INVALID)
      oldValue = Services.prefs["get" + type](aName);

    Services.prefs["set" + type](aName, aValue);
    this.preferences.push([aName, type, oldValue]);
  },

  getScriptContext: function(aDOMWindow, aScriptURL) {
    if (!this.windowEntryMap.has(aDOMWindow))
      return null;
    let windowEntry = this.windowEntryMap.get(aDOMWindow);
    if (!(aScriptURL in windowEntry.scripts))
      return null;
    return windowEntry.scripts[aScriptURL];
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
          OverlayManagerInternal.createWindowEntry(domWindow, overlays);
        }
        break;
      case "unload":
        if (!this.windowEntryMap.has(domWindow)) {
          Cu.reportError("Saw unload event for unknown window " + domWindow.location);
          return;
        }
        let windowEntry = this.windowEntryMap.get(domWindow);
        OverlayManagerInternal.destroyWindowEntry(windowEntry);
        break;
      }
    }
    catch (e) {
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

OverlayManagerInternal.init();
