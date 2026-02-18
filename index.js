
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
        currentState[element].light1 = 'off';
        currentState[element].light2 = 'off';
        queueCommand(element, 'off');
    });
};


// #sudo ./sendook  -f 304200000 -0 333 -1 333 -r 3 -p 10000 101101101101101101101101101100100100100
const sendCommand = ({device, command, publications}) => {
    exec(`${execDirectory}sendook -f 304200000 -0 333 -1 333 -r 5 -p 10000  ${id_code}${devices[device][command]} | grep "Message"`, (err, stdout, stderr) => {
        console.log(`[sendook]: ${stdout}`);
        if (publications) {
            publications.forEach(p => {
                client.publish(p.topic, p.message, p.options);
                console.log(`publishing status to ${p.topic}: ${p.message}`);
            });
        }
    });
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
        console.log(`subscribing to ${item} statuses`);
        client.publish(`${mqttTopicPrefix}${item}/connected`, 'true', options);
        client.subscribe(`${mqttTopicPrefix}${item}/setFanOn`);
        client.subscribe(`${mqttTopicPrefix}${item}/setRotationSpeed`);
        client.subscribe(`${mqttTopicPrefix}${item}/setRotationDirection`);
        if (devices[item]['light1']) {
            client.subscribe(`${mqttTopicPrefix}${item}/setLight1On`);
        }
        if (devices[item]['light2']) {
            client.subscribe(`${mqttTopicPrefix}${item}/setLight2On`);
        }
    });
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
        case 'setLight1On':
            if (isTrue(message)) {
                if (currentState[device].light1 === 'off') {
                    console.log(`turning ${device} light on`);
                    currentState[device].light1 = 'on';
                    queueCommand(device, 'light1', [{
                        topic: `${mqttTopicPrefix}${device}/getLight1On`,
                        message: 'true',
                        options: options
                    }]);
                }
            } else {
                if (currentState[device].light1 !== 'off') {
                    console.log(`turning ${device} light off`);
                    currentState[device].light1 = 'off';
                    queueCommand(device, 'light1', [{
                        topic: `${mqttTopicPrefix}${device}/getLight1On`,
                        message: 'false',
                        options: options
                    }]);
                }
            }
            break;
        case 'setLight2On':
            if (isTrue(message)) {
                if (currentState[device].light2 === 'off') {
                    console.log(`turning ${device} light on`);
                    currentState[device].light2 = 'on';
                    queueCommand(device, 'light2', [{
                        topic: `${mqttTopicPrefix}${device}/getLight2On`,
                        message: 'true',
                        options: options
                    }]);
                }
            } else {
                if (currentState[device].light2 !== 'off') {
                    console.log(`turning ${device} light off`);
                    currentState[device].light2 = 'off';
                    queueCommand(device, 'light2', [{
                        topic: `${mqttTopicPrefix}${device}/getLight2On`,
                        message: 'false',
                        options: options
                    }]);
                }
            }
            break;
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
            queueCommand(device, 'reverse', [{
                topic: `${mqttTopicPrefix}${device}/getRotationDirection`,
                message: currentState[device].fanDirection,
                options: options
            }]);
            break;
        default:
            console.log('invalid message');
    }
});
