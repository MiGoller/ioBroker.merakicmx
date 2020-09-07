"use strict";

/*
 * Created with @iobroker/create-adapter v1.16.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

// Load your modules here, e.g.:
// const fs = require("fs");
const CmxReceiver = require("./lib/cmxreceiver");
const MerakiCmxDbConnector = require("./lib/merakiCmxDbConnector");

let cmxReceiver;
let intervalFlagStaleDevices;
let scan_check_for_stale_devices = 30;

class Merakicmx extends utils.Adapter {

    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "merakicmx",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here
        MerakiCmxDbConnector.setAdapter(this);
        scan_check_for_stale_devices = Number(this.config.scan_check_for_stale_devices) || 30;

        cmxReceiver = CmxReceiver(this, MerakiCmxDbConnector.processMerakiCmxData);

        // Issue #19: Verify the connection to Meraki API
        //      MerakiCmxDbConnector.processMerakiCmxData() will manage the adapter's connection state.
        // MerakiCmxDbConnector.setAdapterConnectionState(true);
        this.log.info("Waiting for first Meraki CMX API data delivery ...");

        MerakiCmxDbConnector.flagStaleDevices(false);

        intervalFlagStaleDevices = setInterval(() => MerakiCmxDbConnector.flagStaleDevices(false), scan_check_for_stale_devices * 1000);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            if (cmxReceiver) {
                this.log.info("Shutting down Meraki CMX API receiver ...");
                cmxReceiver.close();
                if (intervalFlagStaleDevices) clearInterval(intervalFlagStaleDevices);

                MerakiCmxDbConnector.flagStaleDevices(true);
                MerakiCmxDbConnector.setAdapterConnectionState(false);
            }
            this.log.info("cleaned everything up...");
            callback();
        } catch (e) {
            callback();
        }
    }
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Merakicmx(options);
} else {
    // otherwise start the instance directly
    new Merakicmx();
}