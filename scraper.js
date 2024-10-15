const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

require('dotenv').config();

const API_KEY = process.env.LOCATIONIQ_API_KEY;  // Chave API LocationIQ
const MAX_REQUESTS = 5;  // Limite de requisições à API (free tier = 5000 reqs diárias)
let requestCount = 0;  // Contador para acompanhar o número de requisições

// Função para fazer geocodificação reversa e obter o endereço a partir de latitude e longitude
async function reverseGeocode(lat, lng) {
  if (requestCount >= MAX_REQUESTS) {
    console.log('Limite de requisições atingido. Parando as requisições à API.');
    return { display_name: 'Desconhecido' };
  }

  const url = `https://us1.locationiq.com/v1/reverse.php?key=${API_KEY}&lat=${lat}&lon=${lng}&format=json`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    requestCount++;

    if (data && data.display_name) {
      return { display_name: data.display_name };
    }
    return { display_name: 'Desconhecido' };
  } catch (error) {
    console.error(`Erro ao buscar geocodificação reversa: ${error}`);
    return { display_name: 'Desconhecido' };
  }
}

// Função para sanitizar o título e remover prefixos numéricos e o endereço
function sanitizeTitle(title) {
  // Remove prefixos numéricos no formato "### - " e mantém apenas a parte antes da primeira vírgula
  const cleanTitle = title.replace(/^\d+\s*-\s*/, '').trim();
  return cleanTitle.split(',')[0].trim(); // Retorna apenas a primeira parte (nome)
}

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const filePath = path.join(__dirname, 'pontos_de_coleta.txt');

  // Verifica se o arquivo já existe, se sim, remove para evitar sobreposição de dados
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  let allPontosDeColeta = []; // Armazena todos os pontos extraídos

  console.log(`Acessando a página principal`);

  // Acessa a página inicial
  await page.goto('https://sistema.gmclog.com.br/info/green?search_state=SP&search_city=', { waitUntil: 'networkidle2' });

  // Extrai o script que contém a variável `locations`
  const scriptContent = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script'));
    const targetScript = scripts.find(script => script.innerHTML.includes('const locations'));
    return targetScript ? targetScript.innerHTML : null;
  });

  if (scriptContent) {
    console.log(`Script com dados encontrado na página principal`);

    // Extrai o conteúdo da variável `locations` do script
    const regex = /const locations = (\[.*?\]);/s;
    const match = scriptContent.match(regex);

    if (match && match[1]) {
      const locationsData = JSON.parse(match[1]);

      // Sanitizar e processar os dados extraídos do `locations`
      for (const location of locationsData) {
        // Sanitiza o nome removendo o prefixo numérico e o endereço
        const nome = sanitizeTitle(location.title) || 'Desconhecido';

        // Usa o LocationIQ para obter o endereço completo (display_name) e outras informações
        const reverseGeoData = await reverseGeocode(location.lat, location.lng);

        const enderecoCompleto = reverseGeoData.display_name;
        const latitude = location.lat;
        const longitude = location.lng;

        // Armazena o ponto de coleta
        allPontosDeColeta.push({
          nome: nome,
          endereco: enderecoCompleto,
          lat: latitude,
          lng: longitude
        });

        // Log do ponto de coleta processado
        console.log(`Processado: ${nome} - ${enderecoCompleto}, Lat: ${latitude}, Lng: ${longitude}`);

        // Se o limite de requisições foi atingido, encerra a iteração
        if (requestCount >= MAX_REQUESTS) {
          console.log('Interrompendo o processamento devido ao limite de requisições.');
          break;
        }
      }
    } else {
      console.log(`Não foi possível encontrar a variável 'locations'`);
    }
  } else {
    console.log(`Nenhum script com dados encontrado na página principal`);
  }

  // Salva os dados no arquivo
  if (allPontosDeColeta.length > 0) {
    const dataToSave = allPontosDeColeta.map(ponto =>
      `Nome: ${ponto.nome}, Endereço Completo: ${ponto.endereco}, Latitude: ${ponto.lat}, Longitude: ${ponto.lng}`
    ).join('\n') + '\n';

    try {
      fs.writeFileSync(filePath, dataToSave); // Salva todos os dados ao final
      console.log(`Dados salvos no arquivo ${filePath}`);
    } catch (err) {
      console.error(`Erro ao salvar os dados: ${err.message}`);
    }
  }

  await browser.close();
})();