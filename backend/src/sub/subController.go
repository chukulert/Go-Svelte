package subController

import (
	"encoding/json"
	"io/ioutil"
	"myModule/config"
	"database/sql"
	"myModule/src/entities"
	"myModule/src/models"
	"net/http"
	// "fmt"
)

func WriteJsonMsg (w http.ResponseWriter, msg string, success bool, code int) {
	message := entities.Msg{
				Message: msg,
				Success: success,
				Code:    code,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(message)
}

func ConnectDB (w http.ResponseWriter) (*sql.DB, error) {
    db, err := config.GetMySQLDB()
    if err != nil {
		WriteJsonMsg(w, "Internal Server Error", false, 500)
		return nil, err
	} 
	return db, nil;
}


type AuthenticatedHandler func(http.ResponseWriter, *http.Request, string, *sql.DB, []byte)

//AuthWrapper is a struct that implements the http.Handler interface
type AuthWrapper struct {
    handler AuthenticatedHandler
}

func (aw *AuthWrapper) ServeHTTP(w http.ResponseWriter, r *http.Request) { 
	db, err := ConnectDB(w)
	if err != nil {
		return;
	}
	defer db.Close()

	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		WriteJsonMsg(w, "Internal Server Error", false, 501)
	}

	user := entities.Users{}
		err = json.Unmarshal(body, &user)
		if err != nil {
			WriteJsonMsg(w, "Internal Server Error", false, 502)
		return
	}

  	username, err := models.DegenJWT(user.Editor)
		if err != nil {
		 WriteJsonMsg(w, "Invalid/No JWT", false, 405)	
		 return
	}
    aw.handler(w, r, username, db, body)
}

func AuthAndConnect(handlerToWrap AuthenticatedHandler) *AuthWrapper {
    return &AuthWrapper{handlerToWrap}
}




