"use strict";

//  Core-modules ...
const Promise = require("bluebird");

let adapter;
let adapterConnectionState = false;

let scan_wifi_connectedDevicesOnly = true;
let scan_wifi_regex = "";
let scan_bluetooth_regex = "";
let scan_stale_timeout = 120;
let scan_check_for_stale_devices = 30;

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
    //  Create ioBroker object if it does not exists
    await adapter.setObjectNotExistsAsync(dpId, obj);
    return obj;
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

    //  Create ioBroker state object
    const obj = createStateDP(dpId, dpName, dpRead || true, dpWrite || true, dpType, dpRole);

    //  Update state
    await adapter.setStateAsync(dpId, val, ack);

    return obj;
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

function getSantinizedMac(mac) {
    return mac.replace(/:/g, "");
}

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
                await setStateReadOnlyValue(`${dpDevice}.clientMac`, "clientMac", "text", "value", device.clientMac, true);
                await setStateReadOnlyValue(`${dpDevice}.ipv4`, "ipv4", "text", "value", String(device.ipv4).split("/")[1], true);
                await setStateReadOnlyValue(`${dpDevice}.ipv6`, "ipv6", "text", "value", String(device.ipv6).split("/")[1], true);
                await setStateReadOnlyValue(`${dpDevice}.ssid`, "ssid", "text", "value", device.ssid, true);
                await setStateReadOnlyValue(`${dpDevice}.rssi`, "rssi", "number", "value", Number(device.rssi), true);
                await setStateReadOnlyValue(`${dpDevice}.os`, "os", "text", "value", device.os, true);
                await setStateReadOnlyValue(`${dpDevice}.manufacturer`, "manufacturer", "text", "value", device.manufacturer, true);
                await setStateReadOnlyValue(`${dpDevice}.seenTime`, "seenTime", "number", "date", Number(device.seenEpoch) * 1000, true);
                await setStateReadOnlyValue(`${dpDevice}.latitude`, "latitude", "number", "	value.gps.latitude", Number(device.location.lat), true);
                await setStateReadOnlyValue(`${dpDevice}.longitude`, "longitude", "number", "value.gps.longitude", Number(device.location.lng), true);
                await setStateReadOnlyValue(`${dpDevice}.accuracy`, "accuracy", "number", "value", Number(device.location.unc), true);
                await setStateReadOnlyValue(`${dpDevice}.gps-coordinates`, "gps-coordinates", "text", "value.gps", `${Number(device.location.lat)},${Number(device.location.lng)}`, true);
                await setStateReadOnlyValue(`${dpDevice}.isConnected`, "isConnected", "boolean", "value.info", deviceIsConnected, true);
                
            }
            else {
                adapter.log.debug(`Ignored Wifi device with mac ${device.clientMac} : ${processDeviceFailure}.`);
            }
        }
    }
}

function processBluetoothDevicesSeen(data) {
    //  https://developer.cisco.com/meraki/scanning-api/#!api-version-2-0/bluetooth-devices
    adapter.log.debug("Processing BluetoothDevicesSeen data ...");

    processAccessPoint(data);
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
    scan_check_for_stale_devices = Number(adapter.config.scan_check_for_stale_devices) || 30;
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

            // adapter.getState(`${device._id}.isConnected`, function(err, stateIC) {
            //     if (stateIC) {
            //         const isConnected = stateIC.val || false;
            //         adapter.log.debug(`    - is connected ${isConnected}`);

            //         if (isConnected) {
            //             adapter.getState(`${device._id}.seenTime`, async function(err,stateLS) {
            //                 const lastSeen = stateLS.val || false;
            //                 adapter.log.debug(`    - last seen at ${lastSeen}`);
    
            //                 if (lastSeen) {
            //                     const tSpan = Date.now() - lastSeen;
            //                     adapter.log.debug(`    - tSpan ${tSpan}`);
            //                     if (tSpan > 15 * 1000) {
            //                         await adapter.setStateAsync(`${device._id}.isConnected`, false, true);
            //                         adapter.log.debug(` - Device ${device._id} last seen at ${lastSeen} seems to be offline.`);
            //                     }
            //                 }
            //             });
            //         }
            //     }
            // });

            try {
                if (device._id.match(/merakicmx\.\d\.devices/g)) {
                    const isConnected = (await adapter.getStateAsync(`${device._id}.isConnected`)).val;
                    adapter.log.silly(`    - is connected ${isConnected}`);

                    if (isConnected) {
                        const lastSeen = (await adapter.getStateAsync(`${device._id}.seenTime`)).val;
                        adapter.log.silly(`    - last seen at ${lastSeen}`);

                        if (lastSeen) {
                            const tSpan = Date.now() - lastSeen;
                            adapter.log.silly(`    - tSpan ${tSpan}`);
                            if ((tSpan >= scan_stale_timeout * 1000) || forceFlag) {
                                await adapter.setStateAsync(`${device._id}.isConnected`, false, true);
                                adapter.log.debug(` - Device ${device._id} last seen at ${lastSeen} seems to be offline.`);
                                staleCounter++;
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
