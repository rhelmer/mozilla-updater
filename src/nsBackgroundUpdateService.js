/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the Update Service.
 *
 * The Initial Developer of the Original Code is Ben Goodger.
 * Portions created by the Initial Developer are Copyright (C) 2004
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Ben Goodger <ben@bengoodger.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const PREF_APP_ID                           = "app.id";
const PREF_APP_VERSION                      = "app.version";
const PREF_UPDATE_APP_ENABLED               = "update.app.enabled";
const PREF_UPDATE_APP_URI                   = "update.app.url";
const PREF_UPDATE_APP_UPDATESAVAILABLE      = "update.app.updatesAvailable";
const PREF_UPDATE_APP_UPDATEVERSION         = "update.app.updateVersion";
const PREF_UPDATE_APP_UPDATEDESCRIPTION     = "update.app.updateDescription";
const PREF_UPDATE_APP_UPDATEURL             = "update.app.updateURL";
const PREF_UPDATE_SHOW_SLIDING_NOTIFICATION = "update.showSlidingNotification";

const PREF_UPDATE_EXTENSIONS_ENABLED        = "update.extensions.enabled";
const PREF_UPDATE_EXTENSIONS_AUTOUPDATE     = "update.extensions.autoUpdate";
const PREF_UPDATE_EXTENSIONS_COUNT          = "update.extensions.count";

const PREF_UPDATE_INTERVAL                  = "update.interval";
const PREF_UPDATE_LASTUPDATEDATE            = "update.lastUpdateDate";
const PREF_UPDATE_SEVERITY                  = "update.severity";

const nsIUpdateService  = Components.interfaces.nsIUpdateService;
const nsIUpdateItem     = Components.interfaces.nsIUpdateItem;

const UPDATED_EXTENSIONS  = 0x01;
const UPDATED_APP         = 0x02;

function nsUpdateService()
{
  this._pref = Components.classes["@mozilla.org/preferences-service;1"]
                         .getService(Components.interfaces.nsIPrefBranch);
  this.watchForUpdates();

  var pbi = this._pref.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
  pbi.addObserver(PREF_UPDATE_APP_ENABLED, this, false);
  pbi.addObserver(PREF_UPDATE_EXTENSIONS_ENABLED, this, false);
  pbi.addObserver(PREF_UPDATE_INTERVAL, this, false);

  // Observe xpcom-shutdown to unhook pref branch observers above to avoid 
  // shutdown leaks.
  var os = Components.classes["@mozilla.org/observer-service;1"]
                     .getService(Components.interfaces.nsIObserverService);
  os.addObserver(this, "xpcom-shutdown", false);
}

nsUpdateService.prototype = {
  _timer: null,
  _pref: null,
  _updateObserver: null,
  _appUpdatesEnabled: true,
  _extUpdatesEnabled: true,
    
  /////////////////////////////////////////////////////////////////////////////
  // nsIUpdateService
  watchForUpdates: function ()
  {
    // This is called when the app starts, so check to see if the time interval
    // expired between now and the last time an automated update was performed.
    // now is the same one that was started last time. 
    this._appUpdatesEnabled = this._pref.getBoolPref(PREF_UPDATE_APP_ENABLED);
    this._extUpdatesEnabled = this._pref.getBoolPref(PREF_UPDATE_EXTENSIONS_ENABLED);
    if (!this._appUpdatesEnabled && !this._extUpdatesEnabled)
      return;
      
    var interval = this._pref.getIntPref(PREF_UPDATE_INTERVAL);
    var lastUpdateTime = this._pref.getIntPref(PREF_UPDATE_LASTUPDATEDATE);
    var timeSinceLastCheck = lastUpdateTime ? this._nowInMilliseconds - lastUpdateTime : 0;
    if (timeSinceLastCheck > interval) {
      this.checkForUpdatesInternal([], 0, nsIUpdateItem.TYPE_ANY, 
                                   nsIUpdateService.SOURCE_EVENT_BACKGROUND);
    }
    else
      this._makeTimer(interval - timeSinceLastCheck);
  },
  
  checkForUpdates: function (aItems, aItemCount, aUpdateTypes, aSourceEvent, aParentWindow)
  {
    switch (aSourceEvent) {
    case nsIUpdateService.SOURCE_EVENT_MISMATCH:
    case nsIUpdateService.SOURCE_EVENT_USER:
      var ww = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
                         .getService(Components.interfaces.nsIWindowWatcher);
      var ary = Components.classes["@mozilla.org/supports-array;1"]
                          .createInstance(Components.interfaces.nsISupportsArray);
      var updateTypes = Components.classes["@mozilla.org/supports-PRUint8;1"]
                                  .createInstance(Components.interfaces.nsISupportsPRUint8);
      updateTypes.data = aUpdateTypes;
      ary.AppendElement(updateTypes);
      var sourceEvent = Components.classes["@mozilla.org/supports-PRUint8;1"]
                                  .createInstance(Components.interfaces.nsISupportsPRUint8);
      sourceEvent.data = aSourceEvent;
      ary.AppendElement(sourceEvent);
      for (var i = 0; i < aItems.length; ++i)
        ary.AppendElement(aItems[i]);

      // This *must* be modal so as not to break startup! This code is invoked before
      // the main event loop is initiated (via checkForMismatches).
      ww.openWindow(aParentWindow, "chrome://mozapps/content/update/update.xul", 
                    "", "chrome,modal,centerscreen", ary);
      break;
    case nsIUpdateService.SOURCE_EVENT_BACKGROUND:
      // Rather than show a UI, call the checkForUpdates function directly here. 
      // The Browser's inline front end update notification system listens for the
      // updates that this function broadcasts.
      this.checkForUpdatesInternal([], 0, aUpdateTypes, aSourceEvent);

      break;
    }  
  },
  
  checkForUpdatesInternal: function (aItems, aItemCount, aUpdateTypes, aSourceEvent)
  {
    // Listen for notifications sent out by the app updater (implemented here) and the
    // extension updater (implemented in nsExtensionItemUpdater)
    if (this._updateObserver) {
      this._updateObserver.destroy();
      this._updateObserver = null;
    }
    this._updateObserver = new nsUpdateObserver(aUpdateTypes, aSourceEvent, this);
    var os = Components.classes["@mozilla.org/observer-service;1"]
                       .getService(Components.interfaces.nsIObserverService);
    if ((aUpdateTypes & nsIUpdateItem.TYPE_ANY) || (aUpdateTypes & nsIUpdateItem.TYPE_APP)) {
      if (this._appUpdatesEnabled) {
        os.addObserver(this._updateObserver, "Update:App:Ended", false);

        var dsURI = this._pref.getComplexValue(PREF_UPDATE_APP_URI, 
                                              Components.interfaces.nsIPrefLocalizedString).data;
        var rdf = Components.classes["@mozilla.org/rdf/rdf-service;1"]
                            .getService(Components.interfaces.nsIRDFService);
        var ds = rdf.GetDataSource(dsURI);
        var rds = ds.QueryInterface(Components.interfaces.nsIRDFRemoteDataSource)
        if (rds.loaded)
          this.datasourceLoaded(ds);
        else {
          var sink = ds.QueryInterface(Components.interfaces.nsIRDFXMLSink);
          sink.addXMLSinkObserver(new nsAppUpdateXMLRDFDSObserver(this));
        }
      }
    }
    if (!(aUpdateTypes & nsIUpdateItem.TYPE_APP)) { // TYPE_EXTENSION, TYPE_ANY, etc.
      if (this._extUpdatesEnabled) {
        os.addObserver(this._updateObserver, "Update:Extension:Item-Ended", false);
        os.addObserver(this._updateObserver, "Update:Extension:Ended", false);

        var em = Components.classes["@mozilla.org/extensions/manager;1"]
                           .getService(Components.interfaces.nsIExtensionManager);
        em.update(aItems, aItems.length);      
      }
    }
    
    if (aSourceEvent == nsIUpdateService.SOURCE_EVENT_BACKGROUND && 
        (this._appUpdatesEnabled || this._extUpdatesEnabled)) {
      this._pref.setIntPref(PREF_UPDATE_LASTUPDATEDATE, this._nowInMilliseconds);

      // If this was a background update, reset timer. 
      this._makeTimer(this._pref.getIntPref(PREF_UPDATE_INTERVAL));
    }
  },
  
  _rdf: null,
  _ncR: function (aProperty)
  {
    return this._rdf.GetResource("http://home.netscape.com/NC-rdf#" + aProperty);
  },
  
  _getProperty: function (aDS, aAppID, aProperty)
  {
    var app = this._rdf.GetResource("urn:mozilla:app:" + aAppID);
    return aDS.GetTarget(app, this._ncR(aProperty), true).QueryInterface(Components.interfaces.nsIRDFLiteral).Value;
  },

  // This is called when the remote update datasource is ready to be parsed.  
  datasourceLoaded: function (aDataSource)
  {
    if (!this._rdf) {
      this._rdf = Components.classes["@mozilla.org/rdf/rdf-service;1"]
                            .getService(Components.interfaces.nsIRDFService);
    }
    // <?xml version="1.0"?>
    // <RDF:RDF xmlns:RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    //          xmlns:NC="http://home.netscape.com/NC-rdf#">
    //   <RDF:Description about="urn:mozilla:app:{ec8030f7-c20a-464f-9b0e-13a3a9e97384}">
    //     <NC:version>1.2</NC:version>
    //     <NC:severity>0</NC:severity>
    //     <NC:URL>http://www.mozilla.org/products/firefox/</NC:URL>
    //     <NC:description>Firefox 1.2 features new goats.</NC:description>
    //   </RDF:Description>
    // </RDF:RDF>
    var pref = Components.classes["@mozilla.org/preferences-service;1"]
                         .getService(Components.interfaces.nsIPrefBranch);
    var appID = pref.getCharPref(PREF_APP_ID);
    var appVersion = pref.getCharPref(PREF_APP_VERSION);
 
    // do update checking here, parsing something like this format:
    var version = this._getProperty(aDataSource, appID, "version");
    var versionChecker = Components.classes["@mozilla.org/updates/version-checker;1"]
                                   .getService(Components.interfaces.nsIVersionChecker);
    if (versionChecker.compare(appVersion, version) < 0) {
      pref.setCharPref(PREF_UPDATE_APP_UPDATEVERSION, version);
    
      var severity = this._getProperty(aDataSource, appID, "severity");
      // Synthesize the real severity value using the hint from the web site
      // and the version.
      pref.setIntPref(PREF_UPDATE_SEVERITY, severity);
      pref.setBoolPref(PREF_UPDATE_APP_UPDATESAVAILABLE, true);
      
      var urlStr = Components.classes["@mozilla.org/supports-string;1"]
                             .createInstance(Components.interfaces.nsISupportsString);
      urlStr.data = this._getProperty(aDataSource, appID, "URL");
      pref.setComplexValue(PREF_UPDATE_APP_UPDATEURL, 
                           Components.interfaces.nsISupportsString, 
                           urlStr);

      var descStr = Components.classes["@mozilla.org/supports-string;1"]
                              .createInstance(Components.interfaces.nsISupportsString);
      descStr.data = this._getProperty(aDataSource, appID, "description");
      pref.setComplexValue(PREF_UPDATE_APP_UPDATEDESCRIPTION, 
                           Components.interfaces.nsISupportsString, 
                           descStr);
    }
    else
      this._clearAppUpdatePrefs();
    
    // The Update Wizard uses this notification to determine that the application
    // update process is now complete. 
    var os = Components.classes["@mozilla.org/observer-service;1"]
                      .getService(Components.interfaces.nsIObserverService);
    os.notifyObservers(null, "Update:App:Ended", "");
  },
  
  datasourceError: function ()
  {
    var os = Components.classes["@mozilla.org/observer-service;1"]
                      .getService(Components.interfaces.nsIObserverService);
    os.notifyObservers(null, "Update:App:Error", "");
    os.notifyObservers(null, "Update:App:Ended", "");
  },

  get updateCount()
  {
    // The number of available updates is the number of extension/theme/other
    // updates + 1 for an application update, if one is available.
    var updateCount = this.extensionUpdatesAvailable;
    if (this.appUpdatesAvailable)
      ++updateCount;
    return updateCount;
  },
  
  get updateSeverity()
  {
    return this._pref.getIntPref(PREF_UPDATE_SEVERITY);
  },
  
  get appUpdateVersion()
  {
    return this._pref.getComplexValue(PREF_UPDATE_APP_UPDATEVERSION, 
                                      Components.interfaces.nsIPrefLocalizedString).data;
  },
  
  get appUpdateDescription()
  {
    return this._pref.getComplexValue(PREF_UPDATE_APP_UPDATEDESCRIPTION, 
                                      Components.interfaces.nsIPrefLocalizedString).data;
  },
  
  get appUpdateURL()
  {
    return this._pref.getComplexValue(PREF_UPDATE_APP_UPDATEURL, 
                                      Components.interfaces.nsIPrefLocalizedString).data;
  },
  
  _appUpdatesAvailable: undefined,
  get appUpdatesAvailable() 
  {
    if (this._appUpdatesAvailable === undefined) {
      return (this._pref.prefHasUserValue(PREF_UPDATE_APP_UPDATESAVAILABLE) && 
              this._pref.getBoolPref(PREF_UPDATE_APP_UPDATESAVAILABLE));
    }
    return this._appUpdatesAvailable;
  },
  set appUpdatesAvailable(aValue)
  {
    this._appUpdatesAvailable = aValue;
    return aValue;
  },
  
  _extensionUpdatesAvailable: undefined,
  get extensionUpdatesAvailable()
  {
    if (this._extensionUpdatesAvailable === undefined)
      return this._pref.getIntPref(PREF_UPDATE_EXTENSIONS_COUNT);
    return this._extensionUpdatesAvailable;
  },
  set extensionUpdatesAvailable(aValue)
  {
    this._extensionUpdatesAvailable = aValue;
    return aValue;
  },
  
  /////////////////////////////////////////////////////////////////////////////
  // nsITimerCallback
  notify: function (aTimer)
  {
    this.checkForUpdatesInternal([], 0, nsIUpdateItem.TYPE_ANY, 
                                 nsIUpdateService.SOURCE_EVENT_BACKGROUND);
  },
  
  /////////////////////////////////////////////////////////////////////////////
  // nsIObserver
  observe: function (aSubject, aTopic, aData)
  {
    switch (aTopic) {
    case "nsPref:changed":
      // User changed update prefs in Tools->Options
      var noUpdatingGoingOn = !this._appUpdatesEnabled && !this._extUpdatesEnabled;
      this._appUpdatesEnabled = this._pref.getBoolPref(PREF_UPDATE_APP_ENABLED);
      this._extUpdatesEnabled = this._pref.getBoolPref(PREF_UPDATE_EXTENSIONS_ENABLED);

      var needsNotification = false;
      if (!this._appUpdatesEnabled) {
        this._clearAppUpdatePrefs();
        needsNotification = true;
      }
      if (!this._extUpdatesEnabled) {
        // Unset prefs used by the update service to signify extension updates
        if (this._pref.prefHasUserValue(PREF_UPDATE_EXTENSIONS_COUNT))
          this._pref.clearUserPref(PREF_UPDATE_EXTENSIONS_COUNT);
        needsNotification = true;
      }

      if (needsNotification) {
        var os = Components.classes["@mozilla.org/observer-service;1"]
                           .getService(Components.interfaces.nsIObserverService);
        var backgroundEvt = Components.interfaces.nsIUpdateService.SOURCE_EVENT_BACKGROUND;
        os.notifyObservers(null, "Update:Ended", backgroundEvt.toString());
      }
      
      var needsToStartTimer = (noUpdatingGoingOn && this._appUpdatesEnabled) ||
                              (noUpdatingGoingOn && this._extUpdatesEnabled);
      // If the update interval changed or we went from a state in which there was
      // no updating going on into one in which there is, we need to start the 
      // update timer
      if (aData == PREF_UPDATE_INTERVAL || needsToStartTimer)
        this._makeTimer(this._pref.getIntPref(PREF_UPDATE_INTERVAL));
      break;
    case "xpcom-shutdown":
      // Clean up held observers etc to avoid leaks. 
      var pbi = this._pref.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
      pbi.removeObserver(PREF_UPDATE_APP_ENABLED, this);
      pbi.removeObserver(PREF_UPDATE_EXTENSIONS_ENABLED, this);
      pbi.removeObserver(PREF_UPDATE_INTERVAL, this);
    
      var os = Components.classes["@mozilla.org/observer-service;1"]
                        .getService(Components.interfaces.nsIObserverService);
      os.removeObserver(this, "xpcom-shutdown");    
      break;
    }  
  },

  /////////////////////////////////////////////////////////////////////////////
  // nsUpdateService
  _makeTimer: function (aDelay)
  {
    if (this._timer) 
      this._timer.cancel();
      
    this._timer = Components.classes["@mozilla.org/timer;1"]
                            .createInstance(Components.interfaces.nsITimer);
    this._timer.initWithCallback(this, aDelay, 
                                 Components.interfaces.nsITimer.TYPE_ONE_SHOT);
  },
  
  get _nowInMilliseconds ()
  {
    var d = new Date();
    return Date.UTC(d.getUTCFullYear(), 
                    d.getUTCMonth(),
                    d.getUTCDay(),
                    d.getUTCHours(),
                    d.getUTCMinutes(),
                    d.getUTCSeconds(),
                    d.getUTCMilliseconds());
  },
  
  _clearAppUpdatePrefs: function ()
  {
    // Unset prefs used by the update service to signify application updates
    if (this._pref.prefHasUserValue(PREF_UPDATE_APP_UPDATESAVAILABLE))
      this._pref.clearUserPref(PREF_UPDATE_APP_UPDATESAVAILABLE);
    if (this._pref.prefHasUserValue(PREF_UPDATE_APP_UPDATEVERSION))
      this._pref.clearUserPref(PREF_UPDATE_APP_UPDATEVERSION);
    if (this._pref.prefHasUserValue(PREF_UPDATE_APP_UPDATEURL))
      this._pref.clearUserPref(PREF_UPDATE_APP_UPDATEDESCRIPTION);
    if (this._pref.prefHasUserValue(PREF_UPDATE_APP_UPDATEURL)) 
      this._pref.clearUserPref(PREF_UPDATE_APP_UPDATEURL);
  },

  /////////////////////////////////////////////////////////////////////////////
  // nsISupports
  QueryInterface: function (aIID) 
  {
    if (!aIID.equals(Components.interfaces.nsIUpdateService) &&
        !aIID.equals(Components.interfaces.nsIObserver) && 
        !aIID.equals(Components.interfaces.nsISupports))
      throw Components.results.NS_ERROR_NO_INTERFACE;
    return this;
  }
};

function nsUpdateObserver(aUpdateTypes, aSourceEvent, aService)
{
  this._pref = Components.classes["@mozilla.org/preferences-service;1"]
                         .getService(Components.interfaces.nsIPrefBranch);
  this._updateTypes = aUpdateTypes;
  this._sourceEvent = aSourceEvent;
  this._service = aService;
}

nsUpdateObserver.prototype = {
  _updateTypes: 0,
  _sourceEvent: 0,
  _updateState: 0,
  _endedTimer : null,
  
  get _doneUpdating()
  {
    var appUpdatesEnabled = this._service._appUpdatesEnabled;
    var extUpdatesEnabled = this._service._extUpdatesEnabled;
  
    var test = 0;
    var updatingApp = (this._updateTypes & nsIUpdateItem.TYPE_ANY || 
                       this._updateTypes & nsIUpdateItem.TYPE_APP) && 
                       appUpdatesEnabled;
    var updatingExt = !(this._updateTypes & nsIUpdateItem.TYPE_APP) &&
                      extUpdatesEnabled;
    
    if (updatingApp)
      test |= UPDATED_APP;
    if (updatingExt)
      test |= UPDATED_EXTENSIONS;
    
    return (this._updateState & test) == test;
  },
  
  /////////////////////////////////////////////////////////////////////////////
  // nsIObserver
  observe: function (aSubject, aTopic, aData)
  {
    switch (aTopic) {
    case "Update:Extension:Started":
      // Reset the count
      this._pref.setIntPref(PREF_UPDATE_EXTENSIONS_COUNT, 0);
      break;
    case "Update:Extension:Item-Ended":
      this._pref.setIntPref(PREF_UPDATE_EXTENSIONS_COUNT, 
                            this._pref.getIntPref(PREF_UPDATE_EXTENSIONS_COUNT) + 1);
      break;
    case "Update:Extension:Ended":
      this._updateState |= UPDATED_EXTENSIONS;
      break;
    case "Update:App:Ended":
      this._updateState |= UPDATED_APP;
      break;
    }
    
    if (this._doneUpdating) {
      // Do the finalize stuff on a timer to let other observers have a chance to
      // handle
      if (this._endedTimer)
        this._endedTimer.cancel();
      this._endedTimer = Components.classes["@mozilla.org/timer;1"]
                                   .createInstance(Components.interfaces.nsITimer);
      this._endedTimer.initWithCallback(this, 0, 
                                        Components.interfaces.nsITimer.TYPE_ONE_SHOT);
    }
  },
  
  notify: function (aTimer)
  {
    // The Inline Browser Update UI uses this notification to refresh its update 
    // UI if necessary.
    var os = Components.classes["@mozilla.org/observer-service;1"]
                        .getService(Components.interfaces.nsIObserverService);
    os.notifyObservers(null, "Update:Ended", this._sourceEvent.toString());

    // Show update notification UI if:
    // We were updating any types and any item was found
    // We were updating extensions and an extension update was found.
    // We were updating app and an app update was found. 
    var updatesAvailable = (((this._updateTypes & nsIUpdateItem.TYPE_EXTENSION) || 
                              (this._updateTypes & nsIUpdateItem.TYPE_ANY)) && 
                            this._pref.getIntPref(PREF_UPDATE_EXTENSIONS_COUNT) != 0);
    if (!updatesAvailable) {
      updatesAvailable = ((this._updateTypes & nsIUpdateItem.TYPE_APP) || 
                          (this._updateTypes & nsIUpdateItem.TYPE_ANY)) && 
                          this._pref.getBoolPref(PREF_UPDATE_APP_UPDATESAVAILABLE);
    }
    
    var showNotification = this._pref.getBoolPref(PREF_UPDATE_SHOW_SLIDING_NOTIFICATION);
    if (showNotification && updatesAvailable && 
        this._sourceEvent == nsIUpdateService.SOURCE_EVENT_BACKGROUND) {
      var sbs = Components.classes["@mozilla.org/intl/stringbundle;1"]
                          .getService(Components.interfaces.nsIStringBundleService);
      var bundle = sbs.createBundle("chrome://mozapps/locale/update/update.properties");

      var alertTitle = bundle.GetStringFromName("updatesAvailableTitle");
      var alertText = bundle.GetStringFromName("updatesAvailableText");
      
      var alerts = Components.classes["@mozilla.org/alerts-service;1"]
                            .getService(Components.interfaces.nsIAlertsService);
      alerts.showAlertNotification("chrome://mozapps/skin/xpinstall/xpinstallItemGeneric.png",
                                    alertTitle, alertText, true, "", this);
    }

    this.destroy();
  },

  destroy: function ()
  {
    var os = Components.classes["@mozilla.org/observer-service;1"]
                        .getService(Components.interfaces.nsIObserverService);

    try { os.removeObserver(this, "Update:Extension:Item-Ended"); } catch (e) { }
    try { os.removeObserver(this, "Update:Extension:Ended");      } catch (e) { }
    try { os.removeObserver(this, "Update:App:Ended");            } catch (e) { }
  },

  ////////////////////////////////////////////////////////////////////////////
  // nsIAlertListener
  onAlertFinished: function ()
  {
  },
  
  onAlertClickCallback: function (aCookie)
  {
    var updates = Components.classes["@mozilla.org/updates/update-service;1"]
                            .getService(Components.interfaces.nsIUpdateService);
    updates.checkForUpdates([], 0, Components.interfaces.nsIUpdateItem.TYPE_ANY, 
                            Components.interfaces.nsIUpdateService.SOURCE_EVENT_USER,
                            null);
  },
  
  /////////////////////////////////////////////////////////////////////////////
  // nsISupports
  QueryInterface: function (aIID) 
  {
    if (!aIID.equals(Components.interfaces.nsIObserver) &&
        !aIID.equals(Components.interfaces.nsIAlertListener) && 
        !aIID.equals(Components.interfaces.nsISupports))
      throw Components.results.NS_ERROR_NO_INTERFACE;
    return this;
  }
};

function nsAppUpdateXMLRDFDSObserver(aUpdateService)
{
  this._updateService = aUpdateService;
}

nsAppUpdateXMLRDFDSObserver.prototype = 
{ 
  _updateService: null,
  
  /////////////////////////////////////////////////////////////////////////////
  // nsIRDFXMLSinkObserver
  onBeginLoad: function(aSink)
  {
  },
  onInterrupt: function(aSink)
  {
  },
  onResume: function(aSink)
  {
  },
  
  onEndLoad: function(aSink)
  {
    aSink.removeXMLSinkObserver(this);
    
    var ds = aSink.QueryInterface(Components.interfaces.nsIRDFDataSource);
    this._updateService.datasourceLoaded(ds);
  },
  
  onError: function(aSink, aStatus, aErrorMsg)
  {
    aSink.removeXMLSinkObserver(this);
    
    this._updateService.datasourceError();
  }
}

function UpdateItem ()
{
}

UpdateItem.prototype = {
  init: function (aID, aVersion, aName, aRow, aUpdateURL, aIconURL, aUpdateRDF, aType)
  {
    this._id = aID;
    this._version = aVersion;
    this._name = aName;
    this._row = aRow;
    this._updateURL = aUpdateURL;
    this._iconURL = aIconURL;
    this._updateRDF = aUpdateRDF;
    this._type = aType;
  },
  
  get id()        { return this._id;        },
  get version()   { return this._version;   },
  get name()      { return this._name;      },
  get row()       { return this._row;       },
  get updateURL() { return this._updateURL; },
  get iconURL()   { return this._iconURL    },
  get updateRDF() { return this._updateRDF; },
  get type()      { return this._type;      },

  get objectSource()
  {
    return { id: this._id, version: this._version, name: this._name, 
             row: this._row, updateURL: this._updateURL, 
             iconURL: this._iconURL, type: this._type }.toSource();
  },

  /////////////////////////////////////////////////////////////////////////////
  // nsISupports
  QueryInterface: function (aIID) 
  {
    if (!aIID.equals(Components.interfaces.nsIUpdateItem) &&
        !aIID.equals(Components.interfaces.nsISupports))
      throw Components.results.NS_ERROR_NO_INTERFACE;
    return this;
  }
};

function nsVersionChecker()
{
}

nsVersionChecker.prototype = {
  /////////////////////////////////////////////////////////////////////////////
  // nsIVersionChecker
  
  // -ve      if B is newer
  // equal    if A == B
  // +ve      if A is newer
  compare: function (aVersionA, aVersionB)
  {
    var a = this._decomposeVersion(aVersionA);
    var b = this._decomposeVersion(aVersionB);
    return a - b;
  },
  
  // Version strings get translated into a "score" that indicates how new
  // the product is. 
  // 
  // a.b.c+ -> a*1000 + b*100 + c*10 + 1*[+]
  // i.e 0.6.1+ = 6 * 100 + 1 * 10 = 611. 
  _decomposeVersion: function (aVersion)
  {
    var result = 0;
    if (aVersion.charAt(aVersion.length-1) == "+") {
      aVersion = aVersion.substr(0, aVersion.length-1);
      result += 1;
    }
    
    var parts = aVersion.split(".");
    result += this._getValidInt(parts[0]) * 1000;
    result += this._getValidInt(parts[1]) * 100;
    result += this._getValidInt(parts[2]) * 10;
    
    return result;
  },
  
  _getValidInt: function (aPartString)
  {
    var integer = parseInt(aPartString);
    if (isNaN(integer))
      return 0;
    return integer;
  },
  
  isValidVersion: function (aVersion)
  {
    var parts = aVersion.split(".");
    if (parts.length == 0)
      return false;
    for (var i = 0; i < parts.length; ++i) {
      var part = parts[i];
      if (i == parts.length - 1) {
        if (part.lastIndexOf("+") != -1) 
          parts[i] = part.substr(0, part.length - 1);
      }
      var integer = parseInt(part);
      if (isNaN(integer))
        return false;
    }
    return true;
  },

  /////////////////////////////////////////////////////////////////////////////
  // nsISupports
  QueryInterface: function (aIID) 
  {
    if (!aIID.equals(Components.interfaces.nsIVersionChecker) &&
        !aIID.equals(Components.interfaces.nsISupports))
      throw Components.results.NS_ERROR_NO_INTERFACE;
    return this;
  }
};

var gModule = {
  _firstTime: true,
  
  registerSelf: function (aComponentManager, aFileSpec, aLocation, aType) 
  {
    if (this._firstTime) {
      this._firstTime = false;
      throw Components.results.NS_ERROR_FACTORY_REGISTER_AGAIN;
    }
    aComponentManager = aComponentManager.QueryInterface(Components.interfaces.nsIComponentRegistrar);
    
    for (var key in this._objects) {
      var obj = this._objects[key];
      aComponentManager.registerFactoryLocation(obj.CID, obj.className, obj.contractID,
                                                aFileSpec, aLocation, aType);
    }
  },
  
  getClassObject: function (aComponentManager, aCID, aIID) 
  {
    if (!aIID.equals(Components.interfaces.nsIFactory))
      throw Components.results.NS_ERROR_NOT_IMPLEMENTED;

    for (var key in this._objects) {
      if (aCID.equals(this._objects[key].CID))
        return this._objects[key].factory;
    }
    
    throw Components.results.NS_ERROR_NO_INTERFACE;
  },
  
  _objects: {
    manager: { CID: Components.ID("{B3C290A6-3943-4B89-8BBE-C01EB7B3B311}"),
               contractID: "@mozilla.org/updates/update-service;1",
               className: "Update Service",
               factory: {
                          createInstance: function (aOuter, aIID) 
                          {
                            if (aOuter != null)
                              throw Components.results.NS_ERROR_NO_AGGREGATION;
                            
                            return (new nsUpdateService()).QueryInterface(aIID);
                          }
                        }
             },
    version: { CID: Components.ID("{9408E0A5-509E-45E7-80C1-0F35B99FF7A9}"),
               contractID: "@mozilla.org/updates/version-checker;1",
               className: "Version Checker",
               factory: {
                          createInstance: function (aOuter, aIID) 
                          {
                            if (aOuter != null)
                              throw Components.results.NS_ERROR_NO_AGGREGATION;
                            
                            return (new nsVersionChecker()).QueryInterface(aIID);
                          }
                        }
             },
    item:    { CID: Components.ID("{F3294B1C-89F4-46F8-98A0-44E1EAE92518}"),
               contractID: "@mozilla.org/updates/item;1",
               className: "Extension Item",
               factory: {
                          createInstance: function (aOuter, aIID) 
                          {
                            if (aOuter != null)
                              throw Components.results.NS_ERROR_NO_AGGREGATION;
                            
                            return new UpdateItem().QueryInterface(aIID);
                          }
                        } 
             }  
   },
  
  canUnload: function (aComponentManager) 
  {
    return true;
  }
};

function NSGetModule(compMgr, fileSpec) 
{
  return gModule;
}

