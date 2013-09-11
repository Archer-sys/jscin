// Copyright 2011 Google Inc. All Rights Reserved.

/**
 * @fileoverview ChromeOS Chinese Input Method in JavaScript Extension
 * @author hungte@google.com (Hung-Te Lin)
 */

/**
 * The root namespace.
 */

var croscin = {};

/**
 * Chinese IME class.
 * @constructor
 */
croscin.IME = function() {
  var self = this;

  // TODO(hungte) Make this a real pref.
  self.debug = jscin.readLocalStorage('debug', false);

  // The engine ID must match input_components.id in manifest file.
  self.kEngineId = 'cros_cin';
  self.kMenuOptions = "options";
  self.kMenuOptionsLabel = chrome.i18n.getMessage("menuOptions");

  self.imctx = {};
  self.im = null;
  self.im_name = '';
  self.im_label = '';

  self.cross_query = {};

  self.kPrefEnabledInputMethodList = 'croscinPrefEnabledInputMethodList';
  self.kPrefDefaultInputMethod = 'croscinPrefDefaultInputMethod';
  self.kPrefSupportNonChromeOS = 'croscinPrefSupportNonChromeOS';
  self.kPrefQuickPunctuations = 'croscinPrefQuckPunctuations';
  self.kPrefDefaultEnabled = 'croscinPrefDefaultEnabled';

  self.pref = {
    im_default: '',
    im_enabled_list: [],
    support_non_chromeos: true,
    quick_punctuations: true,
    default_enabled: true  // Only for non-ChromeOS.
  };

  self.engineID = self.kEngineId;
  self.context = null;

  // Standard utilities
  self.GetContextArg = function() {
    return {'contextID': this.context.contextID};
  }

  self.GetEngineArg = function() {
    return {'engineID': self.kEngineId};
  }

  self.log = function() {
    if (self.debug)
      console.log.apply(console, arguments);
  }

  // Core functions
  self.Commit = function(text) {
    // TODO(hungte) fixme when gen_inp has fixed this.
    if (typeof(text) != typeof('')) {
      text = text[0];
      self.log("croscin.Commit: WARNING: input text is not a simple string.");
    }

    if (text) {
      var arg = self.GetContextArg();
      arg.text = text;
      self.ime_api.commitText(arg);
      self.log("croscin.Commit: value:", text);
      self.CrossQueryKeystrokes(text);
    } else {
      self.log("croscin.Commit: warning: called with empty string.");
    }
  }

  self.CrossQueryKeystrokes = function(ch) {
    var crossQuery = jscin.getCrossQuery();
    if (!crossQuery) {
      return;
    }
    if (!self.cross_query[crossQuery]) {
      // TODO(hungte) cache this in better way....
      var metadata = jscin.getTableMetadatas();
      self.cross_query[crossQuery] = [
          (metadata && metadata[crossQuery]) ? metadata[crossQuery].cname : "",
          jscin.readLocalStorage(
              jscin.kTableDataKeyPrefix + crossQuery, {}).charToKey];
    }
    var cname = self.cross_query[crossQuery][0];
    var char_map = self.cross_query[crossQuery][1];
    var list = char_map ? char_map[ch] : undefined;
    if(list === undefined) {
      return;
    }
    var arg = self.GetContextArg();
    var candidates = [];
    for(var i = 0; i < list.length; i++) {
      candidates[i] = {
        candidate: list[i],
        id: i,
      }
    }
    arg.candidates = candidates;
    self.ime_api.setCandidates(arg);
    self.SetCandidatesWindowProperty({
      auxiliaryTextVisible: true,
      auxiliaryText: chrome.i18n.getMessage('crossQueryAuxText') + cname,
      visible: true,
      pageSize: list.length,
    });
  }

  self.ProcessKeyEvent = function(keyData) {
    self.log("ProcessKeyEvent:", keyData.key);

    // Currently all of the modules uses key down.
    if (keyData.type != 'keydown') {
      return false;
    }

    var ret = self.im.onKeystroke(self.imctx, keyData);
    self.log(dump_inpinfo(self.imctx));

    switch (ret) {
      case jscin.IMKEY_COMMIT:
        self.log("im.onKeystroke: return IMKEY_COMMIT");
        self.UpdateUI();
        self.Commit(self.imctx.cch);
        return true;

      case jscin.IMKEY_ABSORB:
        self.log("im.onKeystroke: return IMKEY_ABSORB");
        self.UpdateUI();
        return true;

      case jscin.IMKEY_IGNORE:
        self.log("im.onKeystroke: return IMKEY_IGNORE");
        self.UpdateUI();
        return false;
    }

    // default: Unknown return value.
    self.log("croscin.ProcessKeyEvent: Unknown return value:", ret);
    return false;
  }

  self.SimulateKeyDown = function(key) {
    var keyEvent = {
      'type': 'keydown',
      'key': key,
      'altKey': false,
      'ctrlKey': false,
      'shiftKey': false,
    };
    return self.ProcessKeyEvent(keyEvent);
  }

  self.SetCandidatesWindowProperty = function(properties) {
    // self.log("SetCandidatesWindowProperty: ", properties);
    var arg = self.GetEngineArg();
    if (arguments.length == 2) {
      // Legacy support.
      var name = arguments[0], value = arguments[1];
      properties = {};
      properties[name] = value;
      self.log('SetCandidatesWindowProperty(' + name + ', ' + value + ')');
    }
    arg.properties = properties;
    self.ime_api.setCandidateWindowProperties(arg);
  }

  self.InitializeUI = function() {
    // Vertical candidates window looks better on ChromeOS.
    // CIN tables don't expect cursor in candidates window.
    self.SetCandidatesWindowProperty({
      vertical: true,
      cursorVisible: false,
      visible: false,
      auxiliaryText: self.im_label,
      auxiliaryTextVisible: false});

    // Setup menu
    self.UpdateMenu();
  }

  self.UpdateComposition = function(text) {
    var arg = self.GetContextArg();
    self.log("croscin.UpdateComposition:", text);
    if (text) {
      arg.text = text;
      // Select everything in composition.
      arg.selectionStart = 0;
      arg.selectionEnd = text.length;
      arg.cursor = text.length;
      self.ime_api.setComposition(arg);
    } else {
      self.ime_api.clearComposition(arg);
    }
    return text;
  }

  self.UpdateCandidates = function(candidate_list, labels) {
    self.log("croscin.UpdateCandidates: elements = " + candidate_list.length +
             ", labels = " + labels);
    if (candidate_list.length > 0) {
      var arg = self.GetContextArg();
      var candidates = [];
      for (var i = 0; i < candidate_list.length; i++) {
        // TODO(hungte) fix label, annotation
        candidates.push({
          'candidate': candidate_list[i],
          'id': i,
          'label': labels.charAt(i),
        });
      }
      self.log('candidates:', candidates);
      arg.candidates = candidates;
      self.ime_api.setCandidates(arg);
      self.SetCandidatesWindowProperty({
        pageSize: candidate_list.length,
        visible: true});
    } else {
      self.SetCandidatesWindowProperty({visible: false});
    }
    return candidate_list.length > 0;
  }

  self.UpdateUI = function(keystroke, mcch, selkey) {
    if (arguments.length == 0) {
      keystroke = self.imctx.keystroke;
      mcch = self.imctx.mcch;
      selkey = self.imctx.selkey;
    }

    var has_composition, has_candidates;
    // process:
    //  - keystroke
    has_composition = self.UpdateComposition(keystroke);
    //  - selkey, mcch
    has_candidates = self.UpdateCandidates(mcch, selkey);
    //  - (TODO) lcch, cch_publish

    self.SetCandidatesWindowProperty({
      auxiliaryText: self.im_label,
      auxiliaryTextVisible: (has_composition || has_candidates) ? true:false});
  }

  self.ActivateInputMethod = function(name) {
    if (name && name == self.im_name) {
      self.log("croscin.ActivateInputMethod: already activated:", name);
      self.UpdateMenu();
      return;
    }

    if (name in jscin.input_methods) {
      self.log("croscin.ActivateInputMethod: Started:", name);
      self.imctx = {};
      self.im = jscin.create_input_method(name, self.imctx);
      self.im_name = name;
      self.im_label = jscin.get_input_method_label(name);
      // TODO(hungte) Move this dirty workaround to jscin global settings.
      self.imctx.allow_ctrl_phrase = self.prefGetQuickPunctuations();
      self.log("croscin.im:", self.im);
      self.InitializeUI();
    } else {
      self.log("croscin.ActivateInputMethod: Invalid item:", name);
    }
  }

  self.UpdateMenu = function() {
    var menu_items = [];

    self.pref.im_enabled_list.forEach(function (name) {
      var label = jscin.get_input_method_label(name);
      if (label)
        label = label + " (" + name + ")";
      else
        label = name;
      menu_items.push({
        "id": "ime:" + name,
        "label": label,
        "style": "radio",
        "checked": name == self.im_name,
      });
    });
    self.log("croscin.UpdateMenu: " + menu_items.length + " items.");
    // Separator is broken on R28, and may not appear after R29.
    // It depends on ChromeOS UI design so let's not use it.
    // menu_items.push({"id": "", "style": "separator"});
    menu_items.push({"id": self.kMenuOptions, "label": self.kMenuOptionsLabel});

    var arg = self.GetEngineArg();
    arg['items'] = menu_items;
    self.ime_api.setMenuItems(arg);
  }

  self.LoadExtensionResource = function(url) {
    var rsrc = chrome.extension.getURL(url);
    var xhr = new XMLHttpRequest();
    self.log("croscin.LoadExtensionResource:", url);
    xhr.open("GET", rsrc, false);
    xhr.send();
    if (xhr.readyState != 4 || xhr.status != 200) {
      self.log("croscin.LoadExtensionResource: failed to fetch:", url);
      return null;
    }
    return xhr.responseText;
  }

  self.genCharToKeyMap = function(data) {
    var map = {};
    for(var key in data.chardef) {
      var chs = data.chardef[key];
      for(var i in chs) {
        var ch = chs[i];
        var keyname = '';
        for(var j in key) {
          if(key[j] in data.keyname) {
            keyname += data.keyname[key[j]];
          }
        }
        if(ch in map) {
          map[ch] = map[ch].concat(keyname);
        } else {
          map[ch] = [keyname];
        }
      }
    }
    data.charToKey = map;
  }

  self.LoadBuiltinTables = function(reload) {
    var list = self.LoadExtensionResource("tables/builtin.json");
    if (!list) {
      self.log("croscin.LoadBuiltinTables: No built-in tables.");
      return;
    }
    var table_metadata = jscin.getTableMetadatas();
    list = JSON.parse(list);
    for (var table_name in list) {
      if (table_name in table_metadata && !reload) {
        self.log("croscin.LoadBuiltinTables: skip loaded table:", table_name);
        continue;
      }
      var content = self.LoadExtensionResource("tables/" + list[table_name]);
      if (!content) {
        self.log("croscin.LoadBuiltinTables: Failed to load:", table_name);
        continue;
      }
      var results = parseCin(content);
      if (!results[0]) {
        self.log("croscin.LoadBuiltinTables: Incorrect table:", table_name);
        continue;
      }
      var table_content = results[1].data;
      var metadata = results[1].metadata;
      self.log("croscin.LoadBuiltinTables: Load table:", table_name);
      var ename = metadata['ename'];
      metadata['builtin'] = true;
      self.genCharToKeyMap(table_content);
      jscin.addTable(ename, metadata, table_content);
    }
  }

  self.LoadPreferences = function() {
    var pref_im_default = jscin.readLocalStorage(
        self.kPrefDefaultInputMethod, self.pref.im_default);
    var pref_im_enabled_list = jscin.readLocalStorage(
        self.kPrefEnabledInputMethodList, self.pref.im_enabled_list);
    var changed = false;

    // Preferences that don't need to be normalized.
    self.pref.quick_punctuations = jscin.readLocalStorage(
        self.kPrefQuickPunctuations, self.pref.quick_punctuations);
    self.pref.support_non_chromeos = jscin.readLocalStorage(
        self.kPrefSupportNonChromeOS, self.pref.support_non_chromeos);
    self.pref.default_enabled = jscin.readLocalStorage(
        self.kPrefDefaultEnabled, self.pref.default_enabled);

    // Normalize preferences.
    var metadatas = jscin.getTableMetadatas();
    var k = null;
    var enabled_list = [];

    pref_im_enabled_list.forEach(function (key) {
      if (key in metadatas && enabled_list.indexOf(key) < 0)
        enabled_list.push(key);
    });
    if (enabled_list.length < 1) {
      for (k in metadatas) {
        if (enabled_list.indexOf(k) < 0)
          enabled_list.push(k);
      }
    }
    // To compare arrays, hack with string compare.
    if (pref_im_enabled_list.toString() != enabled_list.toString()) {
      pref_im_enabled_list = enabled_list;
      changed = true;
    }

    if (pref_im_enabled_list.indexOf(pref_im_default) < 0) {
      if (pref_im_enabled_list.length > 0) {
        pref_im_default = pref_im_enabled_list[0];
      } else {
        pref_im_default = '';
      }
      changed = true;
    }

    self.pref.im_default = pref_im_default;
    self.pref.im_enabled_list = pref_im_enabled_list;
    self.log("croscin.prefs", self.pref);

    if (changed) {
      self.SavePreferences();
    }
  }

  self.SavePreferences = function() {
    // Preferences that don't need to be normalized.
    jscin.writeLocalStorage(self.kPrefDefaultInputMethod, self.pref.im_default);
    jscin.writeLocalStorage(self.kPrefEnabledInputMethodList,
                            self.pref.im_enabled_list);
    jscin.writeLocalStorage(self.kPrefSupportNonChromeOS,
                            self.pref.support_non_chromeos);
    jscin.writeLocalStorage(self.kPrefQuickPunctuations,
                            self.pref.quick_punctuations);
    jscin.writeLocalStorage(self.kPrefDefaultEnabled,
                            self.pref.default_enabled);
    self.log("preferences saved.");
  }

  self.prefAddEnabledInputMethod = function (name) {
    if (self.pref.im_enabled_list.indexOf(name) < 0) {
      self.pref.im_enabled_list.push(name);
      self.prefSetEnabledList(self.pref.im_enabled_list);
    }
  }

  self.prefRemoveEnabledInputMethod = function (name) {
    var index = self.pref.im_enabled_list.indexOf(name);
    if (index < 0) {
      return;
    }
    self.pref.im_enabled_list.splice(index, 1);
    self.prefSetEnabledList(self.pref.im_enabled_list);
  }

  self.prefSetEnabledList = function (new_list) {
    self.pref.im_enabled_list = new_list;
    self.pref.im_default = new_list.length > 0 ? new_list[0] : '';
    self.SavePreferences();
  }

  self.prefGetQuickPunctuations = function () {
    return self.pref.quick_punctuations;
  }

  self.prefSetQuickPunctuations = function (new_value) {
    self.pref.quick_punctuations = new_value;
    // TODO(hungte) Change this dirty workaround to IM events.
    self.imctx.allow_ctrl_phrase = new_value;
    self.SavePreferences();
  }

  self.prefGetSupportNonChromeOS = function () {
    return self.pref.support_non_chromeos;
  }

  self.prefSetSupportNonChromeOS = function (new_value) {
    self.pref.support_non_chromeos = new_value;
    self.SavePreferences();
  }

  self.prefGetDefaultEnabled = function () {
    return self.pref.default_enabled;
  }

  self.prefSetDefaultEnabled = function (new_value) {
    self.pref.default_enabled = new_value;
    // Hack: pref.default_enabled is more frequently being modified, so let's
    // write it directly.
    jscin.writeLocalStorage(self.kPrefDefaultEnabled,
                            self.pref.default_enabled);
  }

  function Initialize() {
    // Initialization.
    var version = chrome.runtime.getManifest().version;
    var reload = (version !== jscin.getLocalStorageVersion());
    self.LoadBuiltinTables(reload);
    if (reload) {
      jscin.reloadNonBuiltinTables();
      jscin.setLocalStorageVersion(version);
    }
    jscin.reload_configuration();
    self.detect_ime_api();
    self.registerEventHandlers();

    // Start the default input method.
    self.LoadPreferences();
    self.ActivateInputMethod(self.pref.im_default);
  }

  Initialize();
};

croscin.IME.prototype.set_ime_api = function(ime_api, name) {
  var self = this;
  self.ime_api = ime_api;
  self.ime_api_type = name;
  self.log("IME API set to:", name);
}

croscin.IME.prototype.detect_ime_api = function() {
  var self = this;
  /* find out proper ime_api: chrome.input.ime or chrome.experimental.input */
  try {
    self.set_ime_api(chrome.input.ime, "chromeos");
  } catch (err) {
    // Binding failure can't really be catched - it'll simply escape current
    // syntax scope.
  }

  if (!self.ime_api) {
    // provided by input_api/chrome_input_ime.js
    if (ChromeInputIME) {
      self.log("Switched to Javascript Emulation IME API...");
      self.set_ime_api(new ChromeInputIME, "emulation");
      self.ime_api.log = jscin.log;
      chrome.input = { ime: self.ime_api };
    } else {
      self.log("Switched to dummy IME API...");
      self.set_ime_api(self.create_dummy_ime_api(), "dummy");
    }
  }
}

croscin.IME.prototype.create_dummy_ime_api = function() {
  var self = this;
  var dummy_function = function() {};
  var dummy_listener = { addListener: function() {} };
  return {
    clearComposition: dummy_function,
    commitText: dummy_function,
    setCandidates: dummy_function,
    setCandidateWindowProperties: dummy_function,
    setComposition: dummy_function,
    setMenuItems: dummy_function,
    onActivate: dummy_listener,
    onDeactivated: dummy_listener,
    onFocus: dummy_listener,
    onBlur: dummy_listener,
    onKeyEvent: dummy_listener,
    onInputContextUpdate: dummy_listener,
    onCandidateClicked: dummy_listener,
    onMenuItemActivated: dummy_listener,
  };
}

/**
 * Registers event handlers to the browser.
 */
croscin.IME.prototype.registerEventHandlers = function() {
  var self = this;
  ime_api = self.ime_api;

  ime_api.onActivate.addListener(function(engineID) {
    self.log('onActivate: croscin started.');
    self.engineID = engineID;
    self.InitializeUI();
    // We should activate IME here, but in order to speed up we did
    // ActivateInputMethod in Initialize, and use hard-coded engine ID before it
    // is assigned.
  });

  ime_api.onDeactivated.addListener(function(engineID) {
    self.context = null;
  });

  ime_api.onFocus.addListener(function(context) {
    self.context = context;
    // Calling updateUI here to forward unfinished composition (preedit) into
    // the new input element.
    self.UpdateUI();
  });

  ime_api.onBlur.addListener(function(contextID) {
    self.log("croscin: onBlur", contextID);
    if (!self.context) {
      self.log("croscin.onBlur: WARNING: no existing context.");
      return;
    }
    if (self.context.contextID != contextID) {
      self.log("croscin.onBlur: WARNING: incompatible context.",
               self.context.contextID, contextID);
      return;
    }
    // TODO(hungte) Uncomment this if we don't want context to be carried when
    // input focus changes.
    // self.SimulateKeyDown('Esc');
    self.context = null;
  });

  ime_api.onKeyEvent.addListener(function(engine, keyData) {
    self.log("croscin.onKeyEvent", engine, keyData);
    return self.ProcessKeyEvent(keyData);
  });

  ime_api.onInputContextUpdate.addListener(function(context) {
  });

  ime_api.onCandidateClicked.addListener(
      function(engineID, candidateID, button) {
        self.log("onCandidateClicked: ", candidateID,  button);
        if (button == "left") {
          self.SimulateKeyDown(self.imctx.selkey.charAt(candidateID));
        }
  });

  ime_api.onMenuItemActivated.addListener(function(engineID, name) {
    self.log("croscin.onMenuItemActivated: name=", name);

    if (name == self.kMenuOptions) {
      var options_url = chrome.extension.getURL("options/options.html");
      // Tabs are better, but if there are no active windows (which is common in
      // ChromeOS if you put everything behind and activate by menu) then
      // chrome.window.create must be used.
      chrome.tabs.getSelected(null, function(tab) {
        if (tab) {
          chrome.tabs.create({"url": options_url});
        } else {
          chrome.windows.create({
            url: options_url,
            type: "popup",
            width: screen.width * 0.8,
            height: screen.height * 0.8,
            focused: true
          });
        }
      });
    } else if (name.match(/^ime:/)) {
      self.ActivateInputMethod(name.replace(/^ime:/, ''));
    }
  });

  // Implementation events (by emulation).
  if (ime_api.onImplUpdateUI) {
    ime_api.onImplUpdateUI.addListener(function () {
      self.UpdateUI.apply(self, arguments);
    });
  }
  if (ime_api.onImplCommit) {
    ime_api.onImplCommit.addListener(function () {
      self.Commit.apply(self, arguments);
    });
  }

  self.onDebugModeChange = function(new_value) {
    console.log("croscin.onDebugModeChange:", new_value);
    jscin.writeLocalStorage('debug', new_value);
    jscin.debug = new_value;
    self.debug = new_value;
  }

  self.on_config_changed = function() {
    // Some configuration is changed - we need to validate and refresh all.
    self.log("croscin.on_config_changed: notified.");
    jscin.reload_configuration();
    self.InitializeUI();
  }

  window.jscin = jscin;
};
