
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
	.help()
	.alias('help', 'h')
	.argv;


const iqDirectory = (argv.iqDirectory) ? argv.iqDirectory : '/usr/src/app/fan-recordings/';
const execDirectory = (argv.execDirectory) ? argv.execDirectory : '/usr/src/app/rpitx/';
const mqttHost = (argv.mqttHost) ? argv.mqttHost : 'localhost';

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
		currentState[element].fan = 'off';
		currentState[element].fanDirection = '0';
		currentState[element].light1 = 'off';
		currentState[element].light2 = 'off';
		queueCommand(element, 'off');
	});
};


// #sudo ./sendook  -f 304200000 -0 333 -1 333 -r 3 -p 10000 101101101101101101101101101100100100100
const sendCommand = ({device, command}) => {
	exec(`${execDirectory}sendook -f 304200000 -0 333 -1 333 -r 5 -p 10000  ${id_code}${devices[device][command]} | grep "Message"`, (err, stdout, stderr) => {
		console.log(`[sendook]: ${stdout}`);
	});
};

const queueCommand = (device, command) => {
	commandQueue.push({device: device, command: command});
};


// constantly try to send commands after certain delays
const processCommands = () => {
	if (commandQueue.length > 0) {
		sendCommand(commandQueue.shift());
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



initSetup();

console.log(`connecting to mqtt broker: ${mqttHost}`);
const client = mqtt.connect(`mqtt://${mqttHost}`);

client.on('connect', () => {
	console.log('mqtt connected');
	Object.keys(devices).forEach((item) => {
		console.log(`subscribing to ${item} statuses`);
		client.publish(`${item}/connected`, 'true');
		client.subscribe(`${item}/setFanOn`);
		client.subscribe(`${item}/setRotationSpeed`);
		client.subscribe(`${item}/setRotationDirection`);
		if (devices[item]['light1']) {
			client.subscribe(`${item}/setLight1On`);
		}
		if (devices[item]['light2']) {
			client.subscribe(`${item}/setLight2On`);
		}
	});
});


client.on('message', (topic, message) => {
	topic = topic.toString();
	message = message.toString();

	console.log(`new message\ntopic: ${topic}\nmessage: ${message}`);

	if (topic.split('/').length != 2) {
		return;
	}

	let [device, action] = topic.split('/');

	switch (action) {
		case 'setLight1On':
			if (message === 'true') {
				if (currentState[device].light1 === 'off') {
					console.log(`turning ${device} light on`);
					currentState[device].light1 = 'on';
					queueCommand(device, 'light1');
					client.publish(`${device}/getLight1On`, 'true');
				}
			} else {
				if (currentState[device].light1 !== 'off') {
					console.log(`turning ${device} light off`);
					currentState[device].light1 = 'off';
					queueCommand(device, 'light1');
					client.publish(`${device}/getLight1On`, 'false');
				}
			}
			break;
		case 'setLight2On':
			if (message === 'true') {
				if (currentState[device].light2 === 'off') {
					console.log(`turning ${device} light on`);
					currentState[device].light2 = 'on';
					queueCommand(device, 'light2');
					client.publish(`${device}/getLight2On`, 'true');
				}
			} else {
				if (currentState[device].light2 !== 'off') {
					console.log(`turning ${device} light off`);
					currentState[device].light2 = 'off';
					queueCommand(device, 'light2');
					client.publish(`${device}/getLight2On`, 'false');
				}
			}
			break;
		case 'setFanOn':
			if (message === 'true') {
				if (currentState[device].fan === 'off') {
					console.log(`turning ${device} fan on`);
					// by default, set fan speed to medium
					currentState[device].fan = 'medium';
					queueCommand(device, 'medium');
					client.publish(`${device}/getFanOn`, 'true');
					client.publish(`${device}/getRotationSpeed`, fanStatus['medium'].toString());
				}
			} else {
				console.log(`turning ${device} fan off`);
				queueCommand(device, 'off');
				client.publish(`${device}/getFanOn`, 'false');
			}
			break;
		case 'setRotationSpeed':
			const fanSpeed = convertSpeedToMode(message);
			currentState[device].fan = fanSpeed;
			console.log(`turning ${device} fan to ${message} / ${fanSpeed}`);
			queueCommand(device, fanSpeed);
			client.publish(`${device}/getFanOn`, 'true');
			client.publish(`${device}/getRotationSpeed`, fanStatus[fanSpeed].toString());
			break;
		case 'setRotationDirection':
			currentState[device].fanDirection = message;
			console.log(`turning ${device} direction to ${message}`);
			queueCommand(device, 'reverse');
			client.publish(`${device}/getRotationDirection`, message);
			break;


		default:
			console.log('invalid message');
	}
});





