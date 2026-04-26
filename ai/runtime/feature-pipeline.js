'use strict';

function standardize(reading, scaler) {
  return [
    (reading.temperature - scaler.mean[0]) / scaler.std[0],
    (reading.humidity - scaler.mean[1]) / scaler.std[1],
    (reading.wind - scaler.mean[2]) / scaler.std[2],
    (reading.light - scaler.mean[3]) / scaler.std[3],
    (reading.airQuality - scaler.mean[4]) / scaler.std[4]
  ];
}

function denormalize(features, scaler) {
  return {
    temperature: features[0] * scaler.std[0] + scaler.mean[0],
    humidity: features[1] * scaler.std[1] + scaler.mean[1],
    wind: features[2] * scaler.std[2] + scaler.mean[2],
    light: features[3] * scaler.std[3] + scaler.mean[3],
    airQuality: features[4] * scaler.std[4] + scaler.mean[4]
  };
}

module.exports = { standardize, denormalize };