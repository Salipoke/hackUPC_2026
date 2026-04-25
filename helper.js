/*const fs = require('fs');*/

const generateMockData = () => {
    const getRandomInRange = (min, max, decimals = 1) => 
        parseFloat((Math.random() * (max - min) + min).toFixed(decimals));

    //Calculamos primero la temperatura
    const temperature = getRandomInRange(-10, 100);

    //humedad basada en la temperatura calculada
    let humidity;
    if (temperature >= 35) {
        humidity = getRandomInRange(40, 100); // Rango desorbitado
    } else {
        humidity = getRandomInRange(0, 100);   // Rango normal
    }

    let light;
    if (temperature > 25) {
        light = getRandomInRange(500, 1000); // Más luz en temperaturas altas
    }
    else {
        light = getRandomInRange(100, 500); // Menos luz en temperaturas bajas
    }

    // 3. Retornamos el objeto con los valores ya listos
    return {
        peerId:'emisor-arduino-1', // Afegit perquè el teu emisor el demanava
        timestamp: Date.now(),
        location: {
            lat: getRandomInRange(41.3800, 41.4000, 4), 
            lon: getRandomInRange(2.1500, 2.1700, 4)
        },
        temperature: temperature, // Usamos la variable de arriba
        humidity: humidity,       // Usamos la variable de arriba
        wind: getRandomInRange(0, 100),
        light: light,
        airQuality: getRandomInRange(0, 100)
    };
};

module.exports = { generateMockData };

/*const sendDataToNetwork = () => {
    const sensorData = generateMockData(); 
    
    // Simulem l'enviament P2P
    // myP2PNode.broadcast(JSON.stringify(sensorData)); 

    // CORRECCIÓ: Fem servir 'sensorData' (que és el que hem definit a dalt)
    // Fem servir appendFileSync si vols anar afegint dades en lloc de sobreescriure-les
    fs.appendFileSync('dataset.json', JSON.stringify(sensorData) + "\n"); 
    
    console.log("Dato enviado y guardado a las:", sensorData.timestamp);
};*/