let make = require('../lib/make');



make
  .make('https://github.com/a7medkamel/taskmill-help.git', '8f3a906585a5480a58e6a352c30ce41b3d165b43', { })
  .then((result) => {
    console.dir(result, { depth : 10 });
  })
  .catch((err) => console.error(err))
  ;
