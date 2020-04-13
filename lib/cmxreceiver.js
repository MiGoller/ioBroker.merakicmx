"use strict";

/**
 * Returns a new Meraki CMX Scanning API receiver for ioBroker
 * @param {*} adapter Set to the calling ioBroker adapter instance.
 * @param {*} callback Sets a callback function to process the received data.
 */
function CmxReceiver(adapter, callback) {

    if (!adapter.config) throw new Error("Adapter config is missing.");
    if (!callback) throw new Error("Callback function is missing.");

    //  Setup listener
    const bind = adapter.config.bind || "0.0.0.0";
    const port = adapter.config.port || 1890;
    const route = adapter.config.route || "/cmx";
    const validator = adapter.config.validator;
    const secret = adapter.config.secret;

    //  Setup the Express Server to expose the CMX Scanning API receiver
    const express = require("express");
    const app = express();
    const bodyParser = require("body-parser");
    const morgan = require("morgan");

    //  Setup the body-parser
    app.use(bodyParser.json({ limit: "25mb" }));

    //  Setup express logging
    app.use(morgan("combined"));

    //  Trust your reverse proxy
    app.set("trust proxy", true);
    
    // CMX Location Protocol, see https://documentation.meraki.com/MR/Monitoring_and_Reporting/CMX_Analytics#API_Configuration

    // Meraki asks for the secret first
    app.get(route, function(req, res) {
        //  Send the CMX Scanning API validator code.
        adapter.log.debug(`Meraki asks for validator. Will reply to ${req.ip} (remote address ${req.headers["x-forwarded-for"] || req.connection.remoteAddress}).`);
        res.status(200).send(validator); 
    });

    // Meraki will push the WiFi and bluetooth device data every 1 to 2 minutes
    app.post(route, function(req, res) {
        if (req.body.secret == secret) {
            try {
                //  Push the received data to the callback function
                adapter.log.debug(`Received data from Meraki CMX API at ${req.ip} (remote address ${req.headers["x-forwarded-for"] || req.connection.remoteAddress}).`);
                res.status(200);
                res.send("Ok.");
                if (callback) callback(req.body);
            } catch (error) {
                res.status(500);
                res.send("Internal server error.");
                adapter.log.error(error);
            }
            // res.status(200);
        }
        else {
            adapter.log.error(`Invalid secret received. Check the requester at ${req.ip} (remote address ${req.headers["x-forwarded-for"] || req.connection.remoteAddress}).`);
            res.status(404);
            res.send("Access denied.");
        }
        // res.status(200);
    });

    // Start the receiver
    const cmxServer = app.listen(port, bind, function() {
        adapter.log.debug(`CMX Receiver started and listens on ${bind}:${port}${route} ...`);
    });

    return cmxServer;
}

// Exports

module.exports = CmxReceiver;
