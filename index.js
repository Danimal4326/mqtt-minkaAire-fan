
const yargs = require('yargs');
const mqtt = require('mqtt');
const { exec } = require('child_process');

const { devices, id_code }  = require('./config/config.js');

const argv = yargs
    .option('mqttHost', {
        description: 'Hostname of MQTT broker',
        alias: 'mqtt',
        type: 'string'
    })
    .option('iqDirectory', {
        description: 'Path to codesend binary',
        alias: 'iq',
        type: 'string'
    })
    .option('execDirectory', {
        description: 'Path to codesend binary',
        alias: 'exec',
        type: 'string'
    })
    .option('mqttTopicPrefix', {
        description: 'Topic prefix for MQTT',
        alias: 'prefix',
        type: 'string'
    })
    .help()
    .alias('help', 'h')
    .argv;


const iqDirectory = (argv.iqDirectory) ? argv.iqDirectory : '/usr/src/app/fan-recordings/';
const execDirectory = (argv.execDirectory) ? argv.execDirectory : '/usr/src/app/rpitx/';
const mqttHost = (argv.mqttHost) ? argv.mqttHost : 'localhost';
const mqttTopicPrefix = (argv.mqttTopicPrefix) ? (argv.mqttTopicPrefix.endsWith('/') ? argv.mqttTopicPrefix : argv.mqttTopicPrefix + '/') : '';

// delay between executing commands
const commandDelay = 100;

// fan status speeds
const fanStatus = {
    off: 0,
    low: 33,
    medium: 66,
    high: 100
};

// maintain a current state of the fans
// this gets setup in the initSetup function
var currentState = {};


// maintain a queue of commands
var commandQueue = [];

const initSetup = () => {
    Object.keys(devices).forEach(element => {
        currentState[element] = {};
        currentState[element].fanSpeed = 'low';
        currentState[element].fanActive = '0';
        currentState[element].fanDirection = '1'; // Summer Mode
    });
};


// #sudo ./sendook  -f 304200000 -0 333 -1 333 -r 3 -p 10000 101101101101101101101101101100100100100
const sendCommand = ({device, command, publications}) => {
        console.log(`[sendook]: ${command}`);
        if (publications) {
            publications.forEach(p => {
                client.publish(p.topic, p.message, p.options);
                console.log(`publishing status to ${p.topic}: ${p.message}`);
            });
        }
};

const queueCommand = (device, command, publications = []) => {
    commandQueue.push({device: device, command: command, publications: publications});
};


// constantly try to send commands after certain delays
const processCommands = () => {
    if (commandQueue.length > 0) {
        const command = commandQueue.shift();
        sendCommand(command);
    }
    setTimeout(processCommands, commandDelay);
};

setTimeout(processCommands, commandDelay);


const convertSpeedToMode = (speed) => {
    for (var element in fanStatus) {
        if (speed <= fanStatus[element]) {
            return element;
        }
    }
    return 'off';
};

const isTrue = (val) => {
    const s = val.toString().toLowerCase();
    return s === 'true' || s === 'on' || s === '1';
};


initSetup();

console.log(`connecting to mqtt broker: ${mqttHost}`);
const client = mqtt.connect(`mqtt://${mqttHost}`);

client.on('connect', () => {
    const options = {
        qos: 1,
        retain: true
    };
    console.log('mqtt connected');
    Object.keys(devices).forEach((item) => {
        console.log(`subscribing to ${item} topics`);
        client.publish(`${mqttTopicPrefix}${item}/connected`, 'true', options);

        // Topics to control the devices
        client.subscribe(`${mqttTopicPrefix}${item}/setFanOn`);
        client.subscribe(`${mqttTopicPrefix}${item}/setRotationSpeed`);
        client.subscribe(`${mqttTopicPrefix}${item}/setRotationDirection`);

        // Topics to get initial state from retained messages
        client.subscribe(`${mqttTopicPrefix}${item}/getFanOn`);
        client.subscribe(`${mqttTopicPrefix}${item}/getRotationSpeed`);
        client.subscribe(`${mqttTopicPrefix}${item}/getRotationDirection`);
    });

    // After a delay, publish current state to ensure consistency.
    // This gives the broker time to send us all the retained messages first,
    // and then we can either confirm them or publish our defaults.
    setTimeout(() => {
        console.log('Publishing initial states to sync with broker...');
        Object.keys(devices).forEach((device) => {
            client.publish(`${mqttTopicPrefix}${device}/getFanOn`, currentState[device].fanActive, options);
            client.publish(`${mqttTopicPrefix}${device}/getRotationSpeed`, fanStatus[currentState[device].fanSpeed].toString(), options);
            client.publish(`${mqttTopicPrefix}${device}/getRotationDirection`, currentState[device].fanDirection, options);
        });
    }, 2000); // 2-second delay
});


client.on('message', (topic, message) => {
    topic = topic.toString();
    message = message.toString();

    const options = {
        qos: 1,
        retain: true
    };

    console.log(`new message\ntopic: ${topic}\nmessage: ${message}`);

    let cleanTopic = topic;
    if (mqttTopicPrefix && topic.startsWith(mqttTopicPrefix)) {
        cleanTopic = topic.substring(mqttTopicPrefix.length);
    }

    const lastSlash = cleanTopic.lastIndexOf('/');
    if (lastSlash === -1) {
        return;
    }

    const device = cleanTopic.substring(0, lastSlash);
    const action = cleanTopic.substring(lastSlash + 1);

    if (!devices[device]) return;

    switch (action) {
        // STATE SYNC from retained messages.
        // We update our internal state and then stop to prevent sending commands.
        case 'getFanOn':
            currentState[device].fanActive = message.toString(); // '0' or '1'
            console.log(`[State Sync] ${device} fanActive is now ${currentState[device].fanActive}`);
            return;
        case 'getRotationSpeed':
            const speedMode = convertSpeedToMode(message);
            currentState[device].fanSpeed = speedMode;
            console.log(`[State Sync] ${device} fanSpeed is now ${currentState[device].fanSpeed} (${message}%)`);
            return;
        case 'getRotationDirection':
            currentState[device].fanDirection = message.toString(); // '0' or '1'
            console.log(`[State Sync] ${device} fanDirection is now ${currentState[device].fanDirection}`);
            return;

        // COMMANDS from HomeKit to change device state.
        case 'setFanOn':
            if (isTrue(message)) {
                if (currentState[device].fanActive === '0') {
                    // by default, set fan speed to low
                    let fanSpeed = currentState[device].fanSpeed;
                    if (fanSpeed === 'off') {
                        fanSpeed = 'low';
                        currentState[device].fanSpeed = 'low';
                    }
                    currentState[device].fanActive = '1';
                    console.log(`turning ${device} fan to on / ${fanSpeed}`);
                    queueCommand(device, fanSpeed, [
                        { topic: `${mqttTopicPrefix}${device}/getFanOn`, message: '1', options: options },
                        { topic: `${mqttTopicPrefix}${device}/getRotationSpeed`, message: fanStatus[fanSpeed].toString(), options: options }
                    ]);
                } else {
                    console.log(`${device} fan is already on`);
                    client.publish(`${mqttTopicPrefix}${device}/getFanOn`, '1', options);
                }
            } else {
                const fanSpeed = convertSpeedToMode(0);
                currentState[device].fanActive = '0';
                console.log(`turning ${device} fan off`);
                queueCommand(device, fanSpeed, [{
                    topic: `${mqttTopicPrefix}${device}/getFanOn`,
                    message: '0',
                    options: options
                }]);
            }
            break;
        case 'setRotationSpeed':
            const fanSpeed = convertSpeedToMode(message);
            currentState[device].fanSpeed = fanSpeed;
            if ( fanSpeed === 'off' ) {
                currentState[device].fanActive = '0';
            } else {
                currentState[device].fanActive = '1';
            }
            console.log(`turning ${device} fan to ${message} / ${fanSpeed}`);
            queueCommand(device, fanSpeed, [
                { topic: `${mqttTopicPrefix}${device}/getRotationSpeed`, message: fanStatus[fanSpeed].toString(), options: options },
                { topic: `${mqttTopicPrefix}${device}/getFanOn`, message: currentState[device].fanActive, options: options }
            ]);
            break;
        case 'setRotationDirection':
                currentState[device].fanDirection = message;
                console.log(`turning ${device} direction to ${message}`);
                queueCommand(device, 'reverse');
		    setTimeout(() => {
                    client.publish(`${mqttTopicPrefix}${device}/getRotationDirection`, message, options);
		    }, 3000);
            break;
        default:
            console.log('invalid message');
    }
});
