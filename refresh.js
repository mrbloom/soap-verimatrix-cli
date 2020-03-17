const fs = require('fs');
const soapRequest = require('easy-soap-request');
const parser = require('fast-xml-parser');
const he = require('he');
const yargs = require('yargs');
const  concat  =  require('mississippi').concat;

const argv = yargs
     .usage('refresh -u user -p password -f cams_id.txt')
     .option('u',{alias:'user',demand:'u'})
     .describe('u', 'Verimatrix user')
     .option('p',{alias:'password',demand:'p'})
     .describe('p','Password for verimatrix user')
     .option('h',{
         help: 'h',
         alias: 'help'
     })
     .option('f',{
         alias:'file',
         demand:'f',
         nargs:1,
         describe:'file with nsc ids of none smart card devices'
     })
     .argv;
 const {user,password,file}   =  argv;

 console.log(user,password,file);


 process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

 function template(strings, ...keys) {
     return (function(...values) {
         var dict = values[values.length - 1] || {};
         var result = [strings[0]];
         keys.forEach(function(key, i) {
             var value = Number.isInteger(key) ? values[key] : dict[key];
             result.push(value, strings[i + 1]);
         });
         return result.join('');
     });
 }

 function parse_xml(body, ...properties){
     var options = {
         attributeNamePrefix : "@_",
         attrNodeName:  'false',
         textNodeName : "#text",
         ignoreAttributes : true,
         ignoreNameSpace : false,
         allowBooleanAttributes : false,
         parseNodeValue : true,
         parseAttributeValue : false,
         trimValues: true,
         cdataTagName: "__cdata", //default is 'false'
         cdataPositionChar: "\\c",
         parseTrueNumberOnly: false,
         arrayMode: false, //"strict"
         attrValueProcessor: (val, attrName) => he.decode(val, {isAttributeValue: true}),//default is a=>a
         tagValueProcessor : (val, tagName) => he.decode(val), //default is a=>a
         stopNodes: ["parse-me-as-string"]
     };

     if( parser.validate(body) === true) { //optional (it'll return an object in case it's not valid)
         var jsonObj = parser.parse(body, options);
         return properties.map(property=>findInObject(jsonObj, property))
         // const handle = findInObject(jsonObj, "ns1:handle");
         // const resultText = findInObject(jsonObj, "ns1:resultText");
     }
 }


const isObject = obj => obj !== undefined && obj !== null && obj.constructor == Object;

 function findInObject(obj,property){
     // console.log(obj,property)
     for(let prop in obj){
         const val = obj[prop];
         if (prop===property)
             return val;
         if ( isObject(val) ) {
             const inval = findInObject(val, property);
             if (inval !== undefined)
                 return inval;
         }
     }
     return undefined;
 }



const signon_xml=template`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:omi="http://www.verimatrix.com/omi" xmlns:omit="http://www.verimatrix.com/schemas/OMItypes.xsd">
   <soapenv:Header/>
   <soapenv:Body>
      <omi:signOn>
         <userAttributes>
            <omit:userName>${0}</omit:userName>
            <omit:password>${1}</omit:password>
            <!--Optional:-->
            
         </userAttributes>
      </omi:signOn>
   </soapenv:Body>
</soapenv:Envelope>`;

 const refresh_xml=template`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:omi="http://www.verimatrix.com/omi" xmlns:omit="http://www.verimatrix.com/schemas/OMItypes.xsd">
    <soapenv:Header/>
<soapenv:Body>
<omi:refreshDeviceEntitlements>
<device>
<omit:smsDeviceId>${0}</omit:smsDeviceId>
<omit:smsNetworkId>dvb-network</omit:smsNetworkId>
<omit:deviceType>STB_DVB_NSC2</omit:deviceType>
<omit:networkDeviceId>${0}</omit:networkDeviceId>
</device>
<sessionHandle>
<omit:handle>${1}</omit:handle>
</sessionHandle>
</omi:refreshDeviceEntitlements>
</soapenv:Body>
</soapenv:Envelope>`;

const urlAdminMgmtService = 'https://10.103.2.18:8099/services/AdminMgmtService';
const urlDeviceMgmtService = 'https://10.103.2.18:8099/services/DeviceMgmtService';
const agentHeaders = {
    'user-agent': 'sampleTest',
    'Content-Type': 'text/xml;charset=UTF-8',
    // 'soapAction': url,
};
const timeout = 900000;
const handle = undefined;



 function refresh(nsc_ids,user,password) {
     let xml = signon_xml(user,password);
     const prom_signon = soapRequest({
            url:urlAdminMgmtService,
            xml:xml,
            headers:agentHeaders,
            timeout:timeout
         });

     prom_signon
         .then((result)=>{
             const {response} = result;
             const {headers, body, statusCode} = response;
             const [handle,resultText] = parse_xml(body,"ns1:handle","ns1:resultText");
             return [handle,resultText];})
         .then(([handle,resultText])=>{
              const cams = nsc_ids.split('\n')
              cams.forEach(nsc_id=>{
                 const id = nsc_id.trim().slice(0,10);
                 let xml = refresh_xml(id,handle);
                 const prom_refresh = soapRequest({
                     url:urlDeviceMgmtService,
                     xml:xml,
                     headers:agentHeaders,
                     timeout:timeout
                 });

                 prom_refresh.then(result=>{
                     const {response} = result;
                     const {headers, body, statusCode} = response;
                     const [id,resultText] = parse_xml(body,"ns1:resultId","ns1:resultText");
                     console.log("Refresh entitlements:",id,resultText);
                 }).catch(err=>console.log(err));

             });

         })
         .catch(err=>console.log(err));
 }

 if (file=== '-'){
     process.stdin.pipe(concat())
 }else{
     const nsc_ids = fs.readFileSync(file, "utf8");
     refresh(nsc_ids,user,password);
 }

