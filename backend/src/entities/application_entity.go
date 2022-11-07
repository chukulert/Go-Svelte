package entities

type Applications struct {
	AppAcronym   string `json:"appacronym"`
	Description  string `json:"description"`
	Rnumber      string `json:"rnumber"`
	StartDate    string `json:"startdate"`
	EndDate      string `json:"enddate"`
	PermitCreate string `json:"permitcreate"`
	PermitOpen   string `json:"permitopen"`
	PermitToDo   string `json:"permittodo"`
	PermitDoing  string `json:"permitdoing"`
	PermitDone   string `json:"permitdone"`
	Editor       string `json:"editor"`
	Group        string `json:"group"`
}
