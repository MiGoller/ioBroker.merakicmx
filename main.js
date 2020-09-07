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
// let intervalFlagStaleDevices;
let timeoutFlagStaleDevices;
let scan_check_for_stale_devices = 30;
let isUnloading = true;

/**
 * Check for stale devices and reschedule further checks
 * @param {*} seconds Amout of time in seconds after the adapter will initiate the next check
 * @param {*} adapterInstance The adapter instance for logging
 */
function checkForStaleDevices(seconds, adapterInstance) {
    try {
        // Ensure the adapter does not shut down before checking for stale devices.
        if (!isUnloading) {
            MerakiCmxDbConnector.flagStaleDevices(false);
            // Ensure the adapter still does not shut down before requesting new schedule.
            if (!isUnloading) {
                timeoutFlagStaleDevices = setTimeout(() => checkForStaleDevices(seconds, adapterInstance), seconds * 1000);
            }
            else {
                // Skip to schedule further check for stale devices, because the adapter is schutting down.
                if (adapterInstance) adapterInstance.log.debug("Will skip to reschedule a further check for stale devices, because the adapter is shutting down.");
            }
        }
        else {
            // Skip to check for stale devices, because the adapter is schutting down.
            if (adapterInstance) adapterInstance.log.debug("Will skip to check for stale devices triggered by schedule, because the adapter is shutting down.");
        }
    } catch (error) {
        //  Error occured.
        if (adapterInstance) adapterInstance.log.error(error);
    }
}

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

        // Adapter is up and running
        isUnloading = false;

        // Switch form interval to timeout
        // better use timeout instead of interval to avoid multiple running processes (only start new time when previous action is completed)
        // Thanks to DutchmanNL: https://github.com/ioBroker/ioBroker.repositories/pull/886#issuecomment-688484230
        // MerakiCmxDbConnector.flagStaleDevices(false);
        // intervalFlagStaleDevices = setInterval(() => MerakiCmxDbConnector.flagStaleDevices(false), scan_check_for_stale_devices * 1000);
        checkForStaleDevices(scan_check_for_stale_devices, this);
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
                // if (intervalFlagStaleDevices) clearInterval(intervalFlagStaleDevices);
                if (timeoutFlagStaleDevices) clearTimeout(timeoutFlagStaleDevices);

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