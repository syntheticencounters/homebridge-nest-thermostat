import axios from 'axios';
import { NestPlatform } from './platform';
import { PlatformAccessory, Service } from 'homebridge';
import { PubSub } from '@google-cloud/pubsub';

/**
* Platform Accessory
* An instance of this class is created for each accessory your platform registers
* Each accessory may expose multiple services of different service types.
*/
export class Thermostat {
    private service: Service;

    /**
    * These are just used to create a working example
    * You should implement your own code to track the state of your accessory
    */
    private state = {
        currentHeatingCooling: 0,
        currentTemperature: -270,
        targetHeatingCooling: 0,
        targetTemperature: 10,
        temperatureDisplayUnits: 0
    };

    constructor(
        private readonly platform: NestPlatform,
        private readonly accessory: PlatformAccessory,
    ) {

        // set accessory information
        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Nest')
            .setCharacteristic(this.platform.Characteristic.Model, 'Learning Thermostat')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.serial_number)

        // create a new Thermostat service
        this.service = this.accessory.getService(this.platform.Service.Thermostat) || this.accessory.addService(this.platform.Service.Thermostat);

        // create handlers for required characteristics
        this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
          .onGet(this.onGetCurrentHeatingCoolingState.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
          .onGet(this.onGetHeatingCoolingState.bind(this))
          .onSet(this.onSetHeatingCoolingState.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
          .onGet(this.onGetTemperature.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
          .onGet(this.onGetTargetTemperature.bind(this))
          .onSet(this.onSetTargetTemperature.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
          .onGet(this.onGetDisplayUnits.bind(this))
          .onSet(this.onSetDisplayUnits.bind(this));

        this.connect();
    }

    connect = async () => {
        try {

            // declare access token
            const token = await this.platform.getAccessToken();

            // fetch current state from thermostat
            const url = this.getDeviceURL();
            const { data } = await axios.get(url, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });
            this.platform.log.info('info fetched');

            // update state with current thermostat values
            this.state.currentHeatingCooling = this.heatingCoolingModeToInt(data.traits['sdm.devices.traits.ThermostatMode'].mode);
            this.state.currentTemperature = data.traits['sdm.devices.traits.Temperature'].ambientTemperatureCelsius;
            this.state.targetHeatingCooling = this.heatingCoolingStateToInt(data.traits['sdm.devices.traits.ThermostatHvac'].status);
            this.state.targetTemperature = data.traits['sdm.devices.traits.ThermostatTemperatureSetpoint'].coolCelsius;
            this.state.temperatureDisplayUnits = data.traits['sdm.devices.traits.Settings'].temperatureScale === 'FAHRENHEIT' ? 1 : 0;

            // update accessory with new state valuesTargetHeatingCoolingState
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.state.currentHeatingCooling);
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.state.currentTemperature);
            this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.state.targetHeatingCooling);
            this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.state.targetTemperature);
            this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, this.state.temperatureDisplayUnits);
            this.platform.log.info('thermostat state set');

            // subscribe to devices change events
            const pubsub = new PubSub(this.platform.config.service_account);
            const [topic] = await pubsub.createTopic('projects/sdm-prod/topics/enterprise-afe1d925-161d-4cdd-9947-6115089782fa');

            const [subscription] = await topic.createSubscription('homebridge_system_events');
            subscription.on('message', message => {
                this.platform.log.info('Received message:', message.data.toString());
            });
            subscription.on('error', error => {
                this.platform.log.error('Received error:', error);
            });

        } catch(e) {
            this.platform.log.error(e.message);
        }
    }

    getDeviceURL = () => {
        return `https://smartdevicemanagement.googleapis.com/v1/enterprises/${this.platform.config.project_id}/devices/${this.accessory.context.device.device_id}`;
    }

    heatingCoolingModeToInt = mode => {
        switch(mode) {
            case 'OFF':
            return 0;

            case 'HEAT':
            return 1;

            case 'COOL':
            return 2;

            case 'AUTO':
            return 3;

            default:
            return 0;
        }
    }

    heatingCoolingModeToString = mode => {
        switch(mode) {
            case 0:
            return 'OFF';

            case 1:
            return 'HEAT';

            case 2:
            return 'COOL';

            case 3:
            return 'HEATCOOL';

            default:
            return 'OFF';
        }
    }

    heatingCoolingStateToInt = state => {
        switch(state) {
            case 'OFF':
            return 0;

            case 'HEATING':
            return 1;

            case 'COOLING':
            return 2;

            default:
            return 0;
        }
    }

    onGetCurrentHeatingCoolingState = () => {
        return this.state.currentHeatingCooling;
    }

    onGetHeatingCoolingState = () => {
        return this.state.targetHeatingCooling;
    }

    onSetHeatingCoolingState = async value => {
        try {

            // declare api url and access token
            const url = this.getDeviceURL();
            const token = await this.platform.getAccessToken();

            /*
            console.log({
                command: 'sdm.devices.commands.ThermostatMode.SetMode',
                params: {
                    mode: this.heatingCoolingModeToString(value)
                }
            });
            */

            // send command to thermostat
            await axios.post(`${url}:executeCommand`, {
                command: 'sdm.devices.commands.ThermostatMode.SetMode',
                params: {
                    mode: this.heatingCoolingModeToString(value)
                }
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            // update state with selection
            this.state.currentHeatingCooling = value;
            this.state.targetHeatingCooling = value;
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, value);
            this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, value);

        } catch(e) {
            this.platform.log.error(`Unable to set target heating cooling state. ${e.message || 'An unknown error occurred'}`);
        }
    }

    onGetTemperature = () => {
        return this.state.currentTemperature;
    }

    onGetTargetTemperature = () => {
        return this.state.targetTemperature;
    }

    getCurrentHeatingCoolingModeUrl = () => {
        switch(this.state.currentHeatingCooling) {
            case 1:
            return 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat';

            case 2:
            return 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool';

            case 3:
            return 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange';
        }
        switch(this.state.targetHeatingCooling) {
            case 1:
            return 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat';

            case 2:
            return 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool';

            default:
            return '';
        }
    }

    onSetTargetTemperature = async value => {
        try {

            // declare api url and access token
            const url = this.getDeviceURL();
            const token = await this.platform.getAccessToken();

            /*
            console.log({
                command: this.getCurrentHeatingCoolingModeUrl(),
                params: {
                    ...this.state.currentHeatingCooling === 1 && {
                        heatCelsius: value
                    },
                    ...this.state.currentHeatingCooling === 2 && {
                        coolCelsius: value
                    },
                    ...this.state.currentHeatingCooling === 3 && {
                        coolCelsius: value,
                        heatCelsius: value
                    }
                }
            });
            */

            // send command to thermostat
            this.platform.log.info(`setting temperature to ${value}`);
            await axios.post(`${url}:executeCommand`, {
                command: this.getCurrentHeatingCoolingModeUrl(),
                params: {
                    ...this.state.currentHeatingCooling === 1 && {
                        heatCelsius: value
                    },
                    ...this.state.currentHeatingCooling === 2 && {
                        coolCelsius: value
                    },
                    ...this.state.currentHeatingCooling === 3 && {
                        coolCelsius: value,
                        heatCelsius: value
                    }
                }
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            // update state with selection
            this.state.targetTemperature = value;
            this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, value);

        } catch(e) {
            this.platform.log.error(`Unable to set target temperature. ${e.message || 'An unknown error occurred'}`);
        }
    }

    onGetDisplayUnits = () => {
        return this.state.temperatureDisplayUnits;
    }

    onSetDisplayUnits = value => {
       this.state.temperatureDisplayUnits = value;
       this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, value);
    }
}
