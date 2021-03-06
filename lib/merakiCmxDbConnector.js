"use strict";

//  Core-modules ...
// const Promise = require("bluebird");
const util = require("util");

let adapter;
let adapterConnectionState = false;

let scan_wifi_connectedDevicesOnly = true;
let scan_wifi_regex = "";
let scan_bluetooth_regex = "";
let scan_stale_timeout = 120;
// let scan_check_for_stale_devices = 30;
let track_location_wifi = false;
let track_location_bluetooth = false;
let sendto_places_adapter_wifi = false;
let sendto_places_adapter_instance_wifi = 0;
let sendto_places_adapter_bluetooth = false;
let sendto_places_adapter_instance_bluetooth = 0;
let store_raw_data_wifi = false;
let store_raw_data_bluetooth = false;

let cmxApiTimeoutObj;

const cloudData = {
    access_points: [ ],
    wifiDevices: [ ],
    bluetoothDevices: [ ]
};

const dpPrefix = {
    "adapter": null,
    "wifi_devices": "devices",
    "bluetooth_devices": "bluetoothDevices",
    "access_points": "access_points"
};

const dpMerakiCmxType = {
    "access_point": "device",
    "wifi_devices": "device",
    "bluetooth_devices": "device"
};

/**
 * 
 * @param {*} instanceNo 
 * @param {*} message 
 */
function sendToPlacesAdapter(instanceNo, message) {
    try {
        adapter.log.info(`Sent to places: ${JSON.stringify(message)}`);
        adapter.sendToAsync(`places.${instanceNo}`, message);
    } catch (error) {
        adapter.log.error(`Failed to send message to places.${instanceNo}: ${error}`);
    }
}

/**
 * ============================================================================
 * ----------------------------------------------------------------------------
 *      ioBroker Datapoint helper functions
 * ----------------------------------------------------------------------------
 * ============================================================================
 */

/**
 * Creates an ioBroker Datapoint Object
 * @param {*} dpId The datapoint's id.
 * @param {*} obj ioBroker datapoint object.
 */
async function createDataPointRawAsync(dpId, obj) {
    try {
        //  Create ioBroker object if it does not exists
        await adapter.setObjectNotExistsAsync(dpId, obj);
        return obj;
    } catch (error) {
        adapter.log.error(`Failed to create datapoint id "${dpId}" with definition ${util.inspect(obj)}: ${error}`);
        return false;
    }
}

/**
 * Wrapper to easily create an ioBroker Datapoint Object
 * @param {*} dpId The datapoint's id
 * @param {*} dpType Type of the datapoint
 * @param {*} dpName Name of the datapoint
 * @param {*} dpDesc Description of the datapoint
 */
async function createObjectDP(dpId, dpType, dpName, dpDesc) {
    const obj = {
        "_id": dpId,
        "type": dpType,
        "common": {
            "name": dpName,
            "desc": dpDesc
        },
        "native": {}
    };

    //  Create ioBroker object if it does not exists
    return await createDataPointRawAsync(dpId, obj);
}

/**
 * Wrapper to easily create an ioBroker State datapoint
 * @param {*} dpId The datapoint's id
 * @param {*} dpName Name of the datapoint
 * @param {*} dpRead Set to true to grant read access to the datapoint.
 * @param {*} dpWrite Set to true to grad write access to the datapoint.
 * @param {*} dpType Type of the datapoint
 * @param {*} dpRole Role of the datapoint
 */
async function createStateDP(dpId, dpName, dpRead, dpWrite, dpType, dpRole) {
    const obj = {
        "_id": dpId,
        "type": "state",
        "common": {
            "name": dpName,
            "read": dpRead,
            "write": dpWrite,
            "type": dpType,
            "role": dpRole
        },
        "native": {}
    };

    //  Create ioBroker object if it does not exists
    return await createDataPointRawAsync(dpId, obj);
}

// function createStateReadOnlyDP(dpId, dpName, dpType, dpRole) {
//     return createStateDP(dpId, dpName, true, false, dpType, dpRole);
// }

/**
 * Creates a state datapoint and to set it's value.
 * @param {*} dpId The datapoint's id
 * @param {*} dpName Name of the datapoint
 * @param {*} dpRead Set to true to grant read access to the datapoint.
 * @param {*} dpWrite Set to true to grad write access to the datapoint.
 * @param {*} dpType Type of the datapoint
 * @param {*} dpRole Role of the datapoint
 * @param {*} val The state's value
 * @param {*} ack Ack?
 */
async function setStateValue(dpId, dpName, dpRead, dpWrite, dpType, dpRole, val, ack) {
    adapter.log.silly(`setStateValue --> ${dpId} = ${val}`);

    try {
        //  Create ioBroker state object
        const obj = createStateDP(dpId, dpName, dpRead || true, dpWrite || true, dpType, dpRole);

        //  Update state
        if (obj) {
            await adapter.setStateAsync(dpId, val, ack);
        }

        return obj;
    } catch (error) {
        adapter.log.error(`Failed to set value "${val}" for datapoint id "${dpId}": ${error}`);
        return false;
    }
}

/**
 * Wrapper to create a read only state datapoint and to set it's value.
 * @param {*} dpId The datapoint's id
 * @param {*} dpName Name of the datapoint
 * @param {*} dpType Type of the datapoint
 * @param {*} dpRole Role of the datapoint
 * @param {*} val The state's value
 * @param {*} ack Ack?
 */
async function setStateReadOnlyValue(dpId, dpName, dpType, dpRole, val, ack) {
    // myLogger.silly(`setStateReadOnlyValue --> ${dpId} = ${val}`);

    return setStateValue(dpId, dpName, true, false, dpType, dpRole, val, ack);
}

/**
 * Santinizes a MAC-address for ioBroker (removes ":").
 * @param {*} mac The MAC-address.
 */
function getSantinizedMac(mac) {
    return mac.replace(/:/g, "");
}

/**
 * 
 * @param {*} data 
 */
async function processAccessPoint(data) {
    adapter.log.silly(`AP: ${JSON.stringify(data)}`);

    const dpAp = `${dpPrefix.access_points}.${getSantinizedMac(data.apMac)}`;

    if (!(cloudData.access_points.some(ap => ap.apMac === data.apMac))) {
        //  Add new person to the array
        cloudData.access_points.push( { "apMac": data.apMac, "apTags": data.apTags, "apFloors": data.apFloors, "lastUpdate": Date.now() } );
        adapter.log.debug(`New AP detected: ${data.apMac} .`);

        //  Create datapoint for new AP
        await createObjectDP(dpAp, dpMerakiCmxType.access_point, data.apMac, "");
    }

    //  Update APs information.
    await setStateReadOnlyValue(`${dpAp}.tags`, "tags", "object", "value.info", JSON.stringify(data.apTags), true);
    await setStateReadOnlyValue(`${dpAp}.floors`, "floors", "object", "value.info", JSON.stringify(data.apFloors), true);
}

/**
 * 
 * @param {*} data 
 */
async function processDevicesSeen(data) {
    //  https://developer.cisco.com/meraki/scanning-api/#!api-version-2-0/wifi-devices
    // {
    //     "ipv4": "/192.168.0.38",
    //     "location": {
    //         "lat": 51.5355157,
    //         "lng": -0.06990350000000944,
    //         "unc": 1.233417960754815,
    //         "x": [],
    //         "y": []
    //     },
    //     "seenTime": "2016-09-24T00:06:23Z",
    //     "ssid": ".interwebs",
    //     "os": null,
    //     "clientMac": "18:fe:34:fc:5a:7f",
    //     "seenEpoch": 1474675583,
    //     "rssi": 47,
    //     "ipv6": null,
    //     "manufacturer": "Espressif"
    // }
    adapter.log.debug("Processing DevicesSeen data ...");

    let regExpDevice = null;
    if (scan_wifi_regex && (scan_wifi_regex != "")) {
        regExpDevice = new RegExp(scan_wifi_regex);
        adapter.log.debug(`WiFi device regex pattern: ${regExpDevice.source}`);
    }

    processAccessPoint(data);

    if (data.observations) {
        for (let o in data.observations) {
            const device = data.observations[o];

            adapter.log.silly(`Device: ${JSON.stringify(device)}`);

            //  The device is connected if there is at least one IP address and a SSID.
            const deviceIsConnected = ((device.ssid != null) && ((device.ipv4 != null) || (device.ipv6 != null)));

            //  Check if it does matters if the device is connected.
            let processDevice = false;
            let processDeviceFailure = "";

            if (scan_wifi_connectedDevicesOnly) {
                processDevice = deviceIsConnected;
                if (!deviceIsConnected) {
                    processDeviceFailure="offline";
                }
            }
            else {
                processDevice = true;
            }

            //  Check for regular expressions.
            if ((regExpDevice) && processDevice) {
                const strDevice = `clientMac:${device.clientMac},ipv4:${String(device.ipv4).split("/")[1]},ipv6:${String(device.ipv6).split("/")[1]},ssid:${device.ssid},os:${device.os},manufacturer:${device.manufacturer}`;
                processDevice = processDevice && regExpDevice.test(strDevice);

                if (!processDevice) processDeviceFailure="RegExp pattern mismatch";
            }

            //  Do we have to process the device?
            if (processDevice) {
                const dpDevice = `${dpPrefix.wifi_devices}.${getSantinizedMac(device.clientMac)}`;

                if (!(cloudData.wifiDevices.some(devWifi => devWifi.clientMac === device.clientMac))) {
                    //  Add new device to the array
                    cloudData.wifiDevices.push( { "clientMac": device.clientMac, "lastUpdate": Date.now() } );
                    adapter.log.debug(`New Wifi device detected: ${device.clientMac} .`);
        
                    //  Create datapoint for new device
                    await createObjectDP(dpDevice, dpMerakiCmxType.wifi_devices, device.clientMac, "");
                }

                //  Update device information.
                //  Device and radio data
                await setStateReadOnlyValue(`${dpDevice}.clientMac`, "clientMac", "string", "value", device.clientMac || "NO DATA", true);
                await setStateReadOnlyValue(`${dpDevice}.ipv4`, "ipv4", "string", "value", String(device.ipv4 || "/NO DATA").split("/")[1], true);
                await setStateReadOnlyValue(`${dpDevice}.ipv6`, "ipv6", "string", "value", String(device.ipv6 || "/NO DATA").split("/")[1], true);
                await setStateReadOnlyValue(`${dpDevice}.ssid`, "ssid", "string", "value", device.ssid || "NO DATA", true);
                await setStateReadOnlyValue(`${dpDevice}.rssi`, "rssi", "number", "value", Number(device.rssi || -127), true);
                await setStateReadOnlyValue(`${dpDevice}.os`, "os", "string", "value", device.os || "NO DATA", true);
                await setStateReadOnlyValue(`${dpDevice}.manufacturer`, "manufacturer", "string", "value", device.manufacturer || "NO DATA", true);
                await setStateReadOnlyValue(`${dpDevice}.seenTime`, "seenTime", "number", "date", Number(device.seenEpoch || new Date().valueOf()/1000) * 1000, true);

                //  Location data
                if (device.location) {
                    const lat = Number(device.location.lat || "0");
                    const lng = Number(device.location.lng || "0");

                    //  Track location data in ioBroker?
                    if (track_location_wifi) {
                        await setStateReadOnlyValue(`${dpDevice}.latitude`, "latitude", "number", "	value.gps.latitude", lat, true);
                        await setStateReadOnlyValue(`${dpDevice}.longitude`, "longitude", "number", "value.gps.longitude", lng, true);
                        await setStateReadOnlyValue(`${dpDevice}.accuracy`, "accuracy", "number", "value", Number(device.location.unc || "0"), true);
                        await setStateReadOnlyValue(`${dpDevice}.gps-coordinates`, "gps-coordinates", "string", "value.gps", `${lat},${lng}`, true);
                    }

                    //  Sent to places adapter?
                    if (sendto_places_adapter_wifi) {
                        sendToPlacesAdapter(sendto_places_adapter_instance_wifi, {
                            user:       device.clientMac, 
                            latitude:   lat, 
                            longitude:  lng, 
                            timestamp:  Date.now()
                        });
                    }
                }

                //   Status and raw data
                await setStateReadOnlyValue(`${dpDevice}.isConnected`, "isConnected", "boolean", "value.info", deviceIsConnected, true);
                if (store_raw_data_wifi) await setStateReadOnlyValue(`${dpDevice}.rawData`, "rawData", "object", "value.info", JSON.stringify(device), true);
            }
            else {
                adapter.log.debug(`Ignored Wifi device with mac ${device.clientMac} : ${processDeviceFailure}.`);
            }
        }
    }
}

/**
 * 
 * @param {*} data 
 */
async function processBluetoothDevicesSeen(data) {
    //  https://developer.cisco.com/meraki/scanning-api/#!api-version-2-0/bluetooth-devices
    // {
    //     "location": {
    //         "lat": 52.376515264636,
    //         "lng": 4.9240433145314,
    //         "unc": 48.999999998421,
    //         "x": [         
    //         ],
    //         "y": [        
    //         ]
    //     },
    //     "seenTime": "2017-08-10T12:03:43Z",
    //     "clientMac": "20:91:48:33:68:23",
    //     "seenEpoch": 1502366623,
    //     "rssi": -70
    // }
    adapter.log.debug("Processing BluetoothDevicesSeen data ...");

    let regExpDevice = null;
    if (scan_bluetooth_regex && (scan_bluetooth_regex != "")) {
        regExpDevice = new RegExp(scan_bluetooth_regex);
        adapter.log.debug(`Bluetooth device regex pattern: ${regExpDevice.source}`);
    }

    processAccessPoint(data);

    if (data.observations) {
        for (let o in data.observations) {
            const bleDevice = data.observations[o];

            adapter.log.silly(`Bluetooth device: ${JSON.stringify(bleDevice)}`);

            //  Check if it does matters if the device is connected.
            let processDevice = true;
            let processDeviceFailure = "";

            //  Check for regular expressions.
            if ((regExpDevice) && processDevice) {
                const strDevice = `clientMac:${bleDevice.clientMac}`;
                processDevice = processDevice && regExpDevice.test(strDevice);

                if (!processDevice) processDeviceFailure="RegExp pattern mismatch";
            }

            //  Do we have to process the device?
            if (processDevice) {
                const dpDevice = `${dpPrefix.bluetooth_devices}.${getSantinizedMac(bleDevice.clientMac)}`;

                if (!(cloudData.bluetoothDevices.some(devBle => devBle.clientMac === bleDevice.clientMac))) {
                    //  Add new device to the array
                    cloudData.bluetoothDevices.push( { "clientMac": bleDevice.clientMac, "lastUpdate": Date.now() } );
                    adapter.log.debug(`New bluetooth device detected: ${bleDevice.clientMac} .`);
        
                    //  Create datapoint for new device
                    await createObjectDP(dpDevice, dpMerakiCmxType.bluetooth_devices, bleDevice.clientMac, "");
                }

                //  Update device information.
                //  Device and radio data
                await setStateReadOnlyValue(`${dpDevice}.clientMac`, "clientMac", "string", "value", bleDevice.clientMac, true);
                setStateReadOnlyValue(`${dpDevice}.rssi`, "rssi", "number", "value", Number(bleDevice.rssi || -127), true);
                setStateReadOnlyValue(`${dpDevice}.seenTime`, "seenTime", "number", "date",Number(bleDevice.seenEpoch || new Date().valueOf()/1000) * 1000, true);

                //  Location data
                if (bleDevice.location) {
                    const lat = Number(bleDevice.location.lat || "0");
                    const lng = Number(bleDevice.location.lng || "0");

                    //  Track location data in ioBroker?
                    if (track_location_bluetooth) {
                        await setStateReadOnlyValue(`${dpDevice}.latitude`, "latitude", "number", "	value.gps.latitude", lat, true);
                        await setStateReadOnlyValue(`${dpDevice}.longitude`, "longitude", "number", "value.gps.longitude", lng, true);
                        await setStateReadOnlyValue(`${dpDevice}.accuracy`, "accuracy", "number", "value", Number(bleDevice.location.unc || "0"), true);
                        await setStateReadOnlyValue(`${dpDevice}.gps-coordinates`, "gps-coordinates", "string", "value.gps", `${lat},${lng}`, true);
                    }

                    //  Sent to places adapter?
                    if (sendto_places_adapter_bluetooth) {
                        sendToPlacesAdapter(sendto_places_adapter_instance_bluetooth, {
                            user:       bleDevice.clientMac, 
                            latitude:   lat, 
                            longitude:  lng, 
                            timestamp:  Date.now()
                        });
                    }
                }

                //   Status and raw data
                await setStateReadOnlyValue(`${dpDevice}.isVisible`, "isVisible", "boolean", "value.info", true, true);
                if (store_raw_data_bluetooth) await setStateReadOnlyValue(`${dpDevice}.rawData`, "rawData", "object", "value.info", JSON.stringify(bleDevice), true);
            }
            else {
                adapter.log.debug(`Ignored bluetooth device with mac ${bleDevice.clientMac} : ${processDeviceFailure}.`);
            }
        }
    }
}

/**
 * Resets the adapter's connection state.
 * @param {*} arg Reason for resetting the adapter's connection state
 */
function resetAdapterConnectionState(arg) {
    adapter.log.warn(`Resetting adapter's connection state: ${arg}`);
    setAdapterConnectionState(false);
}

//
//  Functions to export
//

/**
 * Updates the connector's state for the ioBroker instance.
 * @param {boolean} isConnected Set to true if connected.
 */
function setAdapterConnectionState(isConnected) {
    if (!adapter) {
        //  No adapter instance set.
    }
    else {
        adapter.setState("info.connection", isConnected);
        if (isConnected != adapterConnectionState) {
            if (isConnected)
                adapter.log.info("CMX receiver online.");
            else
                adapter.log.info("CMX receiver offline.");
        }
        adapterConnectionState = isConnected;

        // Issue #19: Verify the connection to Meraki API
        /**
         * https://developer.cisco.com/meraki/scanning-api/#!api-version-2-0/delivery-frequency
         * 
         * Meraki cannot provide a guaranteed interval, as it can depend on a number of factors, 
         * including quantity of access points in the network, and the response time (latency) of 
         * the customer receiver. 
         * Typical POST intervals range from 1-2 minute intervals, but are not guaranteed.
         * 
         * Will set the timeout interval for API delivery to 3 minutes.
         */
        if (isConnected) {
            try {
                if (cmxApiTimeoutObj) clearTimeout(cmxApiTimeoutObj);
            } catch (error) {
                //  Do not abort if cmxApiTimeoutObj is empty.
            }

            cmxApiTimeoutObj = setTimeout(resetAdapterConnectionState, 3 * 60 * 1000, "Meraki CMX API timed out.");
        }
    }
}

/**
 * Let's process the Meraki CMX data
 * @param {*} cmxData 
 */
function processMerakiCmxData(cmxData) {
    if (adapter) {
        adapter.log.silly(JSON.stringify(cmxData));

        //  Check for data property
        try {
            if (cmxData.data) {
                switch (cmxData.type) {
                    case "DevicesSeen":
                        processDevicesSeen(cmxData.data);
                        break;

                    case "BluetoothDevicesSeen":
                        processBluetoothDevicesSeen(cmxData.data);
                        break;

                    default:
                        adapter.log.warn(`Unknown CMX data type received: ${cmxData.type}. Skipping data.`);
                        break;
                }
            }
            else {
                //  Data push does not contain any payload data?!
                adapter.log.warn("Data push does not contain any payload data?!");
            }

            // Issue #19: Verify the connection to Meraki API
            setAdapterConnectionState(true);
        } catch (error) {
            adapter.log.error(error);    
        }
    }
}

/**
 * 
 * @param {*} adapter_in 
 */
function setAdapter(adapter_in) {
    adapter = adapter_in;

    scan_wifi_connectedDevicesOnly = Boolean(adapter.config.scan_wifi_connectedDevicesOnly) || true;
    scan_wifi_regex = adapter.config.scan_wifi_regex || "";
    scan_bluetooth_regex = adapter.config.scan_bluetooth_regex || "";
    scan_stale_timeout = Number(adapter.config.scan_stale_timeout) || 120;
    // scan_check_for_stale_devices = Number(adapter.config.scan_check_for_stale_devices) || 30;
    track_location_wifi = Boolean(adapter.config.track_location_wifi) || false;
    track_location_bluetooth = Boolean(adapter.config.track_location_bluetooth) || false;
    sendto_places_adapter_wifi = Boolean(adapter.config.sendto_places_adapter_wifi) || false;
    sendto_places_adapter_instance_wifi = Number(adapter.config.sendto_places_adapter_instance_wifi) || 0;
    sendto_places_adapter_bluetooth = Boolean(adapter.config.sendto_places_adapter_bluetooth) || false;
    sendto_places_adapter_instance_bluetooth = Number(adapter.config.sendto_places_adapter_instance_bluetooth) || 0;
    store_raw_data_wifi = Boolean(adapter.config.store_raw_data_wifi) || false;
    store_raw_data_bluetooth = Boolean(adapter.config.store_raw_data_bluetooth) || false;
}

/**
 * 
 * @param {*} forceFlag 
 */
function flagStaleDevices(forceFlag) {
    let staleCounter = 0;

    adapter.log.debug("Checking for stale devices ...");
    adapter.getDevices(async function (err, devices) {
        for (let d in devices) {
            const device = devices[d];
            adapter.log.silly(` - Device ${device._id}`);

            try {
                if (device._id.match(/merakicmx\.\d\.devices/g)) {
                    const isConnected = (await adapter.getStateAsync(`${device._id}.isConnected`)).val;
                    adapter.log.silly(`    - is connected ${isConnected}`);

                    if ((isConnected) || forceFlag) {
                        const lastSeen = (await adapter.getStateAsync(`${device._id}.seenTime`)).val;
                        adapter.log.silly(`    - last seen at ${lastSeen}`);

                        if ((lastSeen) || forceFlag) {
                            const tSpan = Date.now() - lastSeen;
                            adapter.log.silly(`    - tSpan ${tSpan}`);
                            if ((tSpan >= scan_stale_timeout * 1000) || forceFlag) {
                                await adapter.setStateAsync(`${device._id}.isConnected`, false, true);
                                adapter.log.debug(` - Device ${device._id} last seen at ${lastSeen} seems to be offline.`);
                                staleCounter++;

                                //  Sent to places adapter?
                                if (sendto_places_adapter_wifi) {
                                    //  Set geo position to south pole for offline devices. I assume that you will probably not live at the south pole!
                                    sendToPlacesAdapter(sendto_places_adapter_instance_wifi, {
                                        user:       (await adapter.getStateAsync(`${device._id}.clientMac`)).val,
                                        latitude:   -89.9, 
                                        longitude:  0.1, 
                                        timestamp:  Date.now()
                                    });
                                }
                            }
                        }
                    }
                }
                else if (device._id.match(/merakicmx\.\d\.bluetoothDevices/g)) {
                    const isVisible = (await adapter.getStateAsync(`${device._id}.isVisible`)).val;
                    adapter.log.silly(`    - is visible ${isVisible}`);

                    if ((isVisible) || forceFlag) {
                        const lastSeen = (await adapter.getStateAsync(`${device._id}.seenTime`)).val;
                        adapter.log.silly(`    - last seen at ${lastSeen}`);

                        if ((lastSeen) || forceFlag) {
                            const tSpan = Date.now() - lastSeen;
                            adapter.log.silly(`    - tSpan ${tSpan}`);
                            if ((tSpan >= scan_stale_timeout * 1000) || forceFlag) {
                                await adapter.setStateAsync(`${device._id}.isVisible`, false, true);
                                adapter.log.debug(` - Device ${device._id} last seen at ${lastSeen} seems to be offline.`);
                                staleCounter++;

                                //  Sent to places adapter?
                                if (sendto_places_adapter_bluetooth) {
                                    //  Set geo position to south pole for offline devices. I assume that you will probably not live at the south pole!
                                    sendToPlacesAdapter(sendto_places_adapter_instance_bluetooth, {
                                        user:       (await adapter.getStateAsync(`${device._id}.clientMac`)).val, 
                                        latitude:   -89.9, 
                                        longitude:  0.1, 
                                        timestamp:  Date.now()
                                    });
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                adapter.log.error(error);
            }
        }
        if (staleCounter > 0) adapter.log.debug(`Flagged ${staleCounter} device(s) as offline.`);
    });
}

//  Exports
module.exports = { processMerakiCmxData, setAdapter, setAdapterConnectionState, flagStaleDevices };
