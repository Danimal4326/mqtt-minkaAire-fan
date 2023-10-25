# MingaAire wirelessFan MQTT (HomeKit) Server

Uses:
* rpitx for transmitting the MinkaAire OOK signals

## Raspberry Pi Modification

Set the GPU frequency as done in the install.sh

https://github.com/F5OEO/rpitx/blob/master/install.sh#L35

## Homebridge Config

```
{
	"accessory": "mqttthing",
	"type": "lightbuld",
	"name": "Living Room Fan Light",
	"url": "mqtt://o.xrho.com",
	"topics": {
		"getOn": "familyRoomFan/getLightOn",
		"setOn": "familyRoomFan/setLightOn"
	}
},
{
	"accessory": "mqttthing",
	"type": "fan",
	"name": "Living Room Fan",
	"url": "mqtt://o.xrho.com",
	"topics": {
		"getOn": "familyRoomFan/getFanOn",
		"setOn": "familyRoomFan/setFanOn",
		"getRotationSpeed": "familyRoomFan/getRotationSpeed",
		"setRotationSpeed": "familyRoomFan/setRotationSpeed",
	}
}
```
