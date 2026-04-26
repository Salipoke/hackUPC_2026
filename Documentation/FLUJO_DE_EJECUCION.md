# Flujo de ejecucion de BioMesh. Contexto para agentes

Este documento describe el flujo de ejecucion canonico del proyecto BioMeshP2P.Cualquier contradiccion a este documento, gana este documento.

## Contexto y proposito del proyecto

Este repositorio consiste en un PoC de una red P2P basada en el stack de tecnologias de Pear (Pear runtime, Autobase...) donde varios nodos que representan placas Arduino UNOQ leen metricas ambientales desde sus sensores y toman decisiones con sus respectivas EdgeAI.

Definimos dos tipos de nodo: nodos emisores y nodos observadores.

### Nodos emisores
Un nodo emisor representa una placa Arduino UNOQ la cual recibe activamente la informacion medida por sus sensores. El nodo emisor lee las siguientes metricas:
- Temperatura (Celius)
- Humedad del aire
- Velocidad del viento (km/h)
- Luminosidad (Lumens)
- Hora del dia
Otros metadatos:
- Ubicacion del sensor


> Nota: Esta PoC tiene limitaciones considerables. No disponemos la capacidad de medir todo, solo la temeratura y luminosidad. Tampoco podremos desplegar las placas fisicamente en sitios estrategicos. Esto se discutirá mas adelante en el documento.

El protocolo de actuacion de los nodos esta dividido por rondas, cada ronda consisitendo en dos fases: 
- En la primera fase de cada ronda, cada nodo emisor recibirá metricas. Estas metricas pueden venir de un sensor fisico del arduino o pueden venir de una funcion mock que los genere. Una vez recibidas todas las metricas, la EdgeAI del nodo emisor decidirá si se encuentra en una situacion de 'Alto riesgo', o si no lo está. Una situacion de alto riesgo viene definida por valores fuera de lo calificado como 'usual'. Esta informacion viene derivada de un dataset previamente construido. Una vez se toma la decision sobre la sitacion, se envia la decision junto con las metricas que se han medido.

- En la segunda fase, cada nodo ya sabrá la decisión que ha tomado el mismo y la decision de los demas nodos. Si un numero mayor o igual a `t` nodos emisores califican la situacion de Alto riesgo, activaran medidas para regular la salud ambiental. 't' vendrá dado por el cieling de la mitad de los nodos emisores. Es decir, que en una arquitectura de 3 nodos emisores, se necesitaran 2 veredictos de alto riesgo para activar las medidas.

### Nodos observadores
Se define como un nodo observador aquel que solo recibe informacion dentro de la red P2P y no transmite datos. Conceptualmente es un PC. Este nodo se encarga de recibir la informacion de los nodos emisores y procesarla para posteriormente plasmarla en un Frontend interactivo con un mapa de la ciudad. 

## Limitaciones de la PoC

Esta PoC tiene ciertas limitaciones. Para empezar, se dispone de una sola placa Arduino UNOQ. Tampoco tenemos todos los modulinos necesarios, asi que debemos mockear muchos de los datos. Para la demo se debe conseguir lo siguiente:

- 3 nodos emisores. Una placa Arduino UNOQ y dos mocks desde ordenadores.
- 1 nodo observador

Los nodos emisores mockean sus datos y deciden por rondas si se encuentra una situacion de alto riesgo y si deciden actuar según el proceso explicado anteriormente. En caso positivo, los nodos deben mostrar fisicamente (con un led o por terminal) un mensaje que representa que estan tomando accion contra la temperatura. El nodo observador debe recibir esta informacion y mostrarla al usuario.

Toda esta arquitectura esta montada en una red Peer-to-Peer usando el stack de Pear. Se utiliza una DHT para intercambiar claves y que se vean los diferentes nodos entre si, junto a autobase para guardar los datos.
